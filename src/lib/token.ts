/**
 * Mobile Token Utilities
 *
 * Issues and verifies HS256 JWT tokens used by mobile clients.
 * The token embeds enough claims so that protected routes do NOT
 * need an extra DB round-trip just to identify the caller.
 *
 * Payload shape:
 *   { sub, userId, email, name, role, organizationId?, doctorId?, exp, iat }
 */

import { sign, verify } from "hono/jwt";
import type { Env } from "../types";
import type { OrgRole } from "../types";

export interface TokenPayload {
  sub: string;        // same as userId
  userId: string;
  email: string;
  name: string;
  /** Global user role (from admin plugin) */
  role?: string | null;
  organizationId?: string | null;
  doctorId?: string | null;
  iat?: number;
  exp?: number;
}

/**
 * Parse a human-readable duration string ("7d", "24h", "60m") into seconds.
 * Falls back to 7 days if the format is not recognised.
 */
export const parseDuration = (value: string | undefined): number => {
  if (!value) return 7 * 24 * 60 * 60;
  const match = value.match(/^(\d+)(d|h|m|s)$/);
  if (!match) return 7 * 24 * 60 * 60;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "d": return n * 86400;
    case "h": return n * 3600;
    case "m": return n * 60;
    default:  return n;
  }
};

/**
 * Issue a signed JWT for a given user/session context.
 */
export const issueToken = async (
  payload: Omit<TokenPayload, "iat" | "exp" | "sub">,
  env: Env,
): Promise<string> => {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = parseDuration(env.JWT_EXPIRES_IN);

  const claims: TokenPayload = {
    ...payload,
    sub: payload.userId,
    iat: now,
    exp: now + expiresIn,
  };

  return sign(claims as Record<string, unknown>, env.JWT_SECRET);
};

/**
 * Verify a JWT string and return its typed payload.
 * Throws if the token is missing, invalid, or expired.
 */
export const verifyToken = async (
  token: string,
  secret: string,
): Promise<TokenPayload> => {
  // hono/jwt `verify` throws on failure — we surface typed errors upstream
  const payload = await verify(token, secret);
  return payload as unknown as TokenPayload;
};
