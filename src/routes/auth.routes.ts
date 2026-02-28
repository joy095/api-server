/**
 * Mobile Authentication Routes
 *
 * POST /api/v1/auth/token      — Exchange email+password for a JWT
 * POST /api/v1/auth/refresh    — Exchange a valid JWT for a fresh one
 * GET  /api/v1/auth/me         — Return the authenticated user's profile
 *
 * These routes work alongside better-auth's session endpoints (/api/auth/**)
 * which remain available for web clients.
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createDb } from "../db";
import { account, member, user } from "../db/schema/auth-schema";
import { AppError, Errors } from "../lib/response";
import { ok } from "../lib/response";
import { issueToken, verifyToken } from "../lib/token";
import { requireAuth } from "../middlewares";
import type { Env, OrgRole } from "../types";
import { logger } from "../lib/logger";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const signInSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(1, "Password is required"),
  /** Optionally scope the token to a specific org at sign-in time */
  organizationId: z.string().optional().nullable(),
});

// ─── Password verification ────────────────────────────────────────────────────

async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    const { Argon2id } = await import("oslo/password");
    return await new Argon2id().verify(hash, plain);
  } catch {
    try {
      const { Bcrypt } = await import("oslo/password");
      return await new Bcrypt().verify(hash, plain);
    } catch {
      return false;
    }
  }
}

// ─── Org role resolver ────────────────────────────────────────────────────────

async function resolveOrgRole(
  db: ReturnType<typeof createDb>,
  userId: string,
  organizationId: string | null | undefined,
): Promise<{ role: OrgRole; resolvedOrgId: string | null }> {
  if (!organizationId) return { role: "staff", resolvedOrgId: null };

  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);

  if (!row) {
    throw new AppError(
      "You are not a member of the specified organisation",
      403,
      {
        code: "NOT_A_MEMBER",
        hint: "Remove `organizationId` from the request or ask an admin to add you to that organisation",
      },
    );
  }

  return { role: row.role as OrgRole, resolvedOrgId: organizationId };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const authTokenRoutes = new Hono<{ Bindings: Env }>();

// ── POST /auth/token ──────────────────────────────────────────────────────────

authTokenRoutes.post("/token", async (c) => {
  const requestId: string | undefined = c.get("requestId");

  // 1. Parse body
  let body: z.infer<typeof signInSchema>;
  try {
    const raw = await c.req.json();
    const result = signInSchema.safeParse(raw);
    if (!result.success) {
      const flat = result.error.flatten();
      throw Errors.validation(flat.fieldErrors as Record<string, string[]>);
    }
    body = result.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Request body must be valid JSON", 400, {
      code: "INVALID_JSON",
      hint: "Set Content-Type: application/json and provide a valid JSON body",
    });
  }

  const { email, password, organizationId } = body;
  const db = createDb(c.env);

  // 2. Look up user
  const [userRow] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      role: user.role,
      doctorId: user.doctorId,
    })
    .from(user)
    .where(eq(user.email, email.toLowerCase().trim()))
    .limit(1);

  // Use a generic message to prevent user enumeration
  if (!userRow) {
    throw new AppError("Invalid email or password", 401, {
      code: "INVALID_CREDENTIALS",
      hint: "Double-check your email and password",
    });
  }

  // 3. Account status checks
  if (userRow.banned) {
    const now = new Date();
    if (!userRow.banExpires || userRow.banExpires > now) {
      throw new AppError(
        `Your account has been suspended${userRow.banReason ? `: ${userRow.banReason}` : ""}`,
        403,
        {
          code: "ACCOUNT_BANNED",
          hint: "Contact support if you believe this is a mistake",
          logContext: { userId: userRow.id, banReason: userRow.banReason },
        },
      );
    }
  }

  if (!userRow.emailVerified) {
    throw new AppError("Your email address has not been verified", 403, {
      code: "EMAIL_NOT_VERIFIED",
      hint: "Check your inbox for a verification email. You can request a new one at POST /api/auth/send-verification-email",
    });
  }

  // 4. Fetch password hash
  const [credRow] = await db
    .select({ password: account.password })
    .from(account)
    .where(
      and(eq(account.userId, userRow.id), eq(account.providerId, "credential")),
    )
    .limit(1);

  if (!credRow?.password) {
    throw new AppError(
      "This account uses social login — no password has been set",
      400,
      {
        code: "NO_PASSWORD",
        hint: "Sign in using your social provider (e.g. Google)",
      },
    );
  }

  // 5. Verify password
  const valid = await verifyPassword(password, credRow.password);
  if (!valid) {
    throw new AppError("Invalid email or password", 401, {
      code: "INVALID_CREDENTIALS",
      hint: "Double-check your email and password",
    });
  }

  // 6. Resolve org role
  const { role, resolvedOrgId } = await resolveOrgRole(
    db,
    userRow.id,
    organizationId,
  );

  // 7. Issue JWT
  if (!c.env.JWT_SECRET) {
    logger.error("JWT_SECRET is not configured", { requestId });
    throw Errors.internal("Authentication service is not configured", {
      hint: requestId ? `Reference ID: ${requestId}` : undefined,
    });
  }

  const token = await issueToken(
    {
      userId: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role ?? null,
      organizationId: resolvedOrgId,
      doctorId: userRow.doctorId ?? null,
    },
    c.env,
  );

  logger.info("Mobile sign-in", {
    userId: userRow.id,
    organizationId: resolvedOrgId,
    ...(requestId ? { requestId } : {}),
  });

  return ok(c, {
    token,
    user: {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      role: userRow.role,
      organizationId: resolvedOrgId,
      doctorId: userRow.doctorId,
    },
  });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────

authTokenRoutes.post("/refresh", async (c) => {
  const requestId: string | undefined = c.get("requestId");
  const authHeader = c.req.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError("Authorization header is missing or malformed", 401, {
      code: "UNAUTHORIZED",
      hint: "Include `Authorization: Bearer <token>` in the request headers",
    });
  }

  const oldToken = authHeader.slice(7).trim();
  if (!oldToken) {
    throw new AppError("Token is empty", 401, { code: "UNAUTHORIZED" });
  }

  if (!c.env.JWT_SECRET) {
    logger.error("JWT_SECRET is not configured", { requestId });
    throw Errors.internal("Authentication service is not configured");
  }

  let payload;
  try {
    payload = await verifyToken(oldToken, c.env.JWT_SECRET);
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes("expired")) {
      throw new AppError(
        "Token has expired — sign in again to get a new token",
        401,
        {
          code: "TOKEN_EXPIRED",
          hint: "POST /api/v1/auth/token with your credentials",
        },
      );
    }
    throw new AppError("The provided token is invalid", 401, {
      code: "INVALID_TOKEN",
      hint: "Sign in again via POST /api/v1/auth/token",
    });
  }

  // Re-validate that the user still exists and isn't banned
  const db = createDb(c.env);
  const [userRow] = await db
    .select({ id: user.id, banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, payload.userId))
    .limit(1);

  if (!userRow) {
    throw Errors.unauthorized("User account no longer exists");
  }

  if (userRow.banned) {
    const now = new Date();
    if (!userRow.banExpires || userRow.banExpires > now) {
      throw new AppError("Your account has been suspended", 403, {
        code: "ACCOUNT_BANNED",
        hint: "Contact support if you believe this is a mistake",
      });
    }
  }

  const newToken = await issueToken(
    {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role ?? null,
      organizationId: payload.organizationId ?? null,
      doctorId: payload.doctorId ?? null,
    },
    c.env,
  );

  logger.info("Token refreshed", {
    userId: payload.userId,
    ...(requestId ? { requestId } : {}),
  });

  return ok(c, { token: newToken });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

authTokenRoutes.get("/me", requireAuth, async (c) => {
  const authUser = c.get("user");
  const db = createDb(c.env);

  const [userRow] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      doctorId: user.doctorId,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, authUser.id))
    .limit(1);

  if (!userRow) {
    throw Errors.notFound("User", {
      hint: "The user associated with this token no longer exists. Please sign in again.",
    });
  }

  return ok(c, {
    ...userRow,
    organizationId: authUser.organizationId,
    orgRole: authUser.role,
  });
});
