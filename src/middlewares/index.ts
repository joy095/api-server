/**
 * Middleware stack
 *
 * Execution order (as registered in index.ts):
 *   1. requestId      — attach unique ID to every request
 *   2. errorHandler   — catch + log all thrown errors, return structured JSON
 *   3. requestLogger  — log method / path / status / duration
 *   4. secureHeaders
 *   5. cors
 *   6. csrfProtection (skipped for /sse and /auth)
 */

import { Context, Next } from "hono";
import type { ZodSchema } from "zod";
import { AppError, Errors, errorResponse } from "../lib/response";
import { logger } from "../lib/logger";
import { eq, and } from "drizzle-orm";
import { createDb } from "../db";
import { member } from "../db/schema/auth-schema";
import type { AuthUser, OrgRole } from "../types";
import { verifyToken } from "../lib/token";

// ─── Request ID ───────────────────────────────────────────────────────────────
// Attaches a unique `requestId` to every inbound request so errors logged on
// the server can be correlated with the `requestId` returned to the client.

function generateRequestId(): string {
  // Use crypto.randomUUID() when available (Node 18+, Cloudflare Workers)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return "req_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  // Fallback for older Node versions
  return "req_" + Math.random().toString(36).slice(2, 18);
}

export const attachRequestId = async (c: Context, next: Next) => {
  const id = c.req.header("x-request-id") ?? generateRequestId();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
};

// ─── Request Logger ───────────────────────────────────────────────────────────

export const requestLogger = async (c: Context, next: Next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const requestId: string | undefined = c.get("requestId");

  logger.info(`${c.req.method} ${c.req.path}`, {
    status: c.res.status,
    duration: `${ms}ms`,
    ...(requestId ? { requestId } : {}),
  });
};

// ─── Error Handler ────────────────────────────────────────────────────────────

export const errorHandler = async (c: Context, next: Next) => {
  try {
    await next();
  } catch (err) {
    const requestId: string | undefined = c.get("requestId");
    const method = c.req.method;
    const path = c.req.path;
    const user: AuthUser | undefined = c.get("user");

    // ── Known operational errors ─────────────────────────────────────────────
    if (err instanceof AppError) {
      const isServerError = err.status >= 500;

      const logMeta: Record<string, unknown> = {
        code: err.code,
        status: err.status,
        method,
        path,
        ...(requestId ? { requestId } : {}),
        ...(user?.id ? { userId: user.id } : {}),
        ...(err.fields ? { fields: err.fields } : {}),
        ...(err.logContext ? err.logContext : {}),
      };

      if (isServerError) {
        logger.error(`[${err.code}] ${err.message}`, {
          ...logMeta,
          stack: err.stack,
        });
      } else {
        logger.warn(`[${err.code}] ${err.message}`, logMeta);
      }

      return errorResponse(c, err, requestId);
    }

    // ── Unexpected errors ────────────────────────────────────────────────────
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    logger.error(`[INTERNAL_ERROR] Unhandled exception: ${message}`, {
      stack,
      method,
      path,
      ...(requestId ? { requestId } : {}),
      ...(user?.id ? { userId: user.id } : {}),
    });

    return errorResponse(
      c,
      Errors.internal(
        "An unexpected error occurred. Please try again or contact support.",
        { hint: requestId ? `Reference ID: ${requestId}` : undefined },
      ),
      requestId,
    );
  }
};

// ─── CSRF Protection ──────────────────────────────────────────────────────────

export const csrfProtection = async (c: Context, next: Next) => {
  const method = c.req.method;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new AppError("Content-Type must be application/json", 400, {
        code: "INVALID_CONTENT_TYPE",
        hint: 'Set the Content-Type header to "application/json"',
      });
    }
  }
  return next();
};

// ─── Token Auth ───────────────────────────────────────────────────────────────

export const requireAuth = async (c: Context, next: Next) => {
  const requestId: string | undefined = c.get("requestId");
  const authHeader = c.req.header("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError(
      "Authentication required — include `Authorization: Bearer <token>` in your request",
      401,
      {
        code: "UNAUTHORIZED",
        hint: "Obtain a token via POST /api/v1/auth/token and pass it in the Authorization header",
      },
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AppError("Token is empty", 401, {
      code: "UNAUTHORIZED",
      hint: "The Authorization header must contain a non-empty Bearer token",
    });
  }

  if (!c.env?.JWT_SECRET) {
    logger.error("JWT_SECRET is not configured", { requestId });
    throw new AppError("Authentication service is not configured", 500, {
      code: "CONFIG_ERROR",
      hint: requestId ? `Reference ID: ${requestId}` : undefined,
    });
  }

  let payload;
  try {
    payload = await verifyToken(token, c.env.JWT_SECRET);
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes("expired") || msg.includes("exp")) {
        throw new AppError(
          "Your session has expired — please sign in again",
          401,
          {
            code: "TOKEN_EXPIRED",
            hint: "POST /api/v1/auth/refresh with your current token to get a new one",
          },
        );
      }
      if (
        msg.includes("invalid") ||
        msg.includes("signature") ||
        msg.includes("malformed")
      ) {
        throw new AppError("The provided token is invalid", 401, {
          code: "INVALID_TOKEN",
          hint: "Sign in again via POST /api/v1/auth/token to get a fresh token",
        });
      }
    }
    throw new AppError("Token verification failed", 401, {
      code: "UNAUTHORIZED",
    });
  }

  if (!payload?.userId) {
    throw new AppError("Token payload is malformed — userId is missing", 401, {
      code: "INVALID_TOKEN",
    });
  }

  const organizationId = payload.organizationId ?? null;
  let orgRole: OrgRole = "staff";

  if (organizationId) {
    const db = createDb(c.env);

    const [memberRow] = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, payload.userId),
          eq(member.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!memberRow) {
      throw new AppError(
        "You are not a member of the specified organisation",
        403,
        {
          code: "NOT_A_MEMBER",
          hint: "Request access from an organisation admin or remove `organizationId` from your sign-in request",
          logContext: { userId: payload.userId, organizationId },
        },
      );
    }

    orgRole = memberRow.role as OrgRole;
  }

  const authUser: AuthUser = {
    id: payload.userId,
    name: payload.name,
    email: payload.email,
    globalRole: payload.role ?? null,
    role: orgRole,
    organizationId,
    doctorId: payload.doctorId ?? null,
  };

  c.set("user", authUser);
  await next();
};

// ─── Role Guard ───────────────────────────────────────────────────────────────

export const requireRole = (...roles: OrgRole[]) => {
  return async (c: Context, next: Next) => {
    const user: AuthUser = c.get("user");

    if (!user) {
      throw new AppError("Authentication required", 401, {
        code: "UNAUTHORIZED",
      });
    }

    if (!roles.includes(user.role)) {
      throw new AppError(
        `Your role "${user.role}" does not have permission to perform this action`,
        403,
        {
          code: "INSUFFICIENT_ROLE",
          hint: `This endpoint requires one of: ${roles.join(", ")}`,
          logContext: {
            userId: user.id,
            userRole: user.role,
            requiredRoles: roles,
          },
        },
      );
    }

    return next();
  };
};

// ─── Org Guard ────────────────────────────────────────────────────────────────

export const requireOrg = async (c: Context, next: Next) => {
  const user: AuthUser = c.get("user");

  if (!user?.organizationId) {
    throw new AppError("This endpoint requires an active organisation", 403, {
      code: "NO_ACTIVE_ORG",
      hint: "Include `organizationId` in your POST /api/v1/auth/token request body to scope your token to an organisation",
    });
  }

  return next();
};

// ─── Body Validation ──────────────────────────────────────────────────────────

export const validateBody = (schema: ZodSchema) => {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new AppError("Request body must be valid JSON", 400, {
        code: "INVALID_JSON",
        hint: "Ensure the request body is well-formed JSON and the Content-Type header is application/json",
      });
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      // Convert Zod errors into { fieldName: string[] } for the client
      const flat = result.error.flatten();
      const fields: Record<string, string[]> = {
        ...(flat.fieldErrors as Record<string, string[]>),
      };
      if (flat.formErrors.length > 0) {
        fields["_root"] = flat.formErrors;
      }
      throw Errors.validation(fields);
    }

    c.set("validatedBody", result.data);
    return next();
  };
};

// ─── Query Validation ─────────────────────────────────────────────────────────

export const validateQuery = (schema: ZodSchema) => {
  return async (c: Context, next: Next) => {
    const params: Record<string, string> = {};
    try {
      const url = new URL(c.req.url);
      url.searchParams.forEach((value, key) => {
        params[key] = value;
      });
    } catch {
      throw new AppError("Malformed request URL", 400, { code: "INVALID_URL" });
    }

    const result = schema.safeParse(params);
    if (!result.success) {
      const flat = result.error.flatten();
      const fields: Record<string, string[]> = {
        ...(flat.fieldErrors as Record<string, string[]>),
      };
      if (flat.formErrors.length > 0) {
        fields["_root"] = flat.formErrors;
      }
      throw new AppError("Invalid query parameters", 400, {
        code: "INVALID_QUERY",
        hint: "Check the `fields` object for which query parameters are invalid",
        fields,
      });
    }

    c.set("validatedQuery", result.data);
    return next();
  };
};

// Re-export
export { requireSelfOrAdmin } from "../validateQuery/ownership";
