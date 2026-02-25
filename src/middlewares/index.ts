import { Context, Next } from "hono";
import { ZodError, type ZodSchema } from "zod";
import { AppError } from "../lib/response";
import { logger } from "../lib/logger";
import { eq, and } from "drizzle-orm";
import createAuthHandler from "../lib/auth";
import { createDb } from "../db";
import { member } from "../db/schema/auth-schema";
import type { AuthUser, OrgRole } from "../types";

// ─── Request Logger Middleware ────────────────────────────────────────────────

export const requestLogger = async (c: Context, next: Next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info(`${c.req.method} ${c.req.path}`, {
    status: c.res.status,
    duration: `${duration}ms`,
  });
};

// ─── Error Handler Middleware ─────────────────────────────────────────────────

export const errorHandler = async (c: Context, next: Next) => {
  try {
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn(`AppError: ${err.message}`, {
        status: err.status,
        code: err.code,
      });
      return c.json(
        { success: false, error: err.message, code: err.code },
        err.status,
      );
    }

    if (err instanceof Error) {
      logger.error(`Error: ${err.message}`, { stack: err.stack });
    } else {
      logger.error("Unknown error", { err });
    }

    return c.json(
      {
        success: false,
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  }
};

// ─── CSRF Protection Middleware ───────────────────────────────────────────────

export const csrfProtection = async (c: Context, next: Next) => {
  const method = c.req.method;
  if (["GET", "OPTIONS", "HEAD"].includes(method)) return next();

  const contentType = c.req.header("content-type");
  if (!contentType) {
    throw new AppError("Missing Content-Type header", 400, "CSRF_CHECK_FAILED");
  }

  return next();
};

// ─── Authentication Middleware ────────────────────────────────────────────────
//
// Validates the bearer token using better-auth, then resolves the user's
// org-scoped role from the member table using session.activeOrganizationId.
//
// Sets `c.get("user"): AuthUser` for downstream middleware.

export const requireAuth = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError(
      "Missing or invalid Authorization header",
      401,
      "UNAUTHORIZED",
    );
  }

  const auth = createAuthHandler(c.env);

  // Use better-auth's built-in session validation from the raw request
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user || !session?.session) {
    throw new AppError("Invalid or expired session", 401, "UNAUTHORIZED");
  }

  const { user: baUser, session: baSession } = session;
  const organizationId = baSession.activeOrganizationId ?? null;

  let orgRole: OrgRole = "staff"; // safe default

  if (organizationId) {
    // Resolve the member record for this user in the active org
    const db = createDb(c.env);
    const [memberRow] = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, baUser.id),
          eq(member.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!memberRow) {
      throw new AppError(
        "You are not a member of this organisation",
        403,
        "NOT_A_MEMBER",
      );
    }

    orgRole = memberRow.role as OrgRole;
  }

  const authUser: AuthUser = {
    id: baUser.id,
    name: baUser.name,
    email: baUser.email,
    globalRole: baUser.role,
    role: orgRole,
    organizationId,
    doctorId: (baUser as any).doctorId ?? null,
  };

  c.set("user", authUser);
  return next();
};

// ─── Org-Scoped Role Authorization ───────────────────────────────────────────
//
// All roles are checked against the org membership, NOT the global user.role.
// This means a user who is "admin" in org A has no elevated rights in org B.

export const requireRole = (...roles: OrgRole[]) => {
  return async (c: Context, next: Next) => {
    const user: AuthUser = c.get("user");

    if (!user) throw new AppError("Unauthorized", 401);

    if (!roles.includes(user.role)) {
      throw new AppError(
        `Forbidden: requires one of [${roles.join(", ")}]`,
        403,
        "INSUFFICIENT_ROLE",
      );
    }

    return next();
  };
};

// ─── Org Context Guard ────────────────────────────────────────────────────────
//
// Ensures the request is scoped to an active organisation.
// Add this before any org-specific route to guarantee organizationId is present.

export const requireOrg = async (c: Context, next: Next) => {
  const user: AuthUser = c.get("user");

  if (!user?.organizationId) {
    throw new AppError(
      "No active organisation — set the activeOrganizationId in your session",
      403,
      "NO_ACTIVE_ORG",
    );
  }

  return next();
};

// ─── Body Validation Middleware ───────────────────────────────────────────────

export const validateBody = (schema: ZodSchema) => {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const result = schema.safeParse(body);

      if (!result.success) {
        throw new AppError(
          "Validation failed",
          422,
          JSON.stringify(result.error.flatten()),
        );
      }

      c.set("validatedBody", result.data);
      return next();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("Invalid request body", 400);
    }
  };
};

// ─── Query Validation Middleware ──────────────────────────────────────────────

export const validateQuery = (schema: ZodSchema) => {
  return async (c: Context, next: Next) => {
    try {
      // Use the native URLSearchParams to avoid manual parsing bugs
      const url = new URL(c.req.url);
      const params: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const result = schema.safeParse(params);

      if (!result.success) {
        throw new AppError(
          "Invalid query parameters",
          400,
          JSON.stringify(result.error.flatten()),
        );
      }

      c.set("validatedQuery", result.data);
      return next();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("Invalid query parameters", 400);
    }
  };
};

// Re-export ownership helper
export { requireSelfOrAdmin } from "../validateQuery/ownership";
