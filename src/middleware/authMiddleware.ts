// middleware/auth.ts
import { Context, MiddlewareHandler } from "hono";
import { jwtVerify, createRemoteJWKSet, JWTPayload, errors } from "jose";

// User type from your JWT payload
export type User = {
  id: string;
  sub: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  role: "user" | "admin" | "owner" | string;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

type Variables = {
  user: User;
  userId: string;
  jwtPayload: JWTPayload;
};

// Extend Hono context types
declare module "hono" {
  interface ContextVariableMap extends Variables {}
}

// Cache JWKS at module level (survives hot reloads in dev)
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(c: Context, authUrl: string) {
  if (!jwksCache) {
    const jwksUrl = new URL(
      c.env.AUTH_SERVER + "/api/auth/jwks",
      authUrl,
    ).toString();
    console.log(`[JWKS] Initializing for: ${jwksUrl}`);

    jwksCache = createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 60000, // 1 minute cooldown between fetches
      cacheMaxAge: 86400000, // 24 hours cache
    });
  }
  return jwksCache;
}

export const verifyBetterAuthJWT: MiddlewareHandler<{
  Variables: Variables;
}> = async (c: Context, next) => {
  const authHeader = c.req.header("authorization");
  const authUrl = c.env.AUTH_SERVER;

  console.log(
    `[Auth] ${c.req.method} ${c.req.path} - Auth present: ${!!authHeader}`,
  );

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        error: "Unauthorized",
        message:
          "Missing or invalid authorization header. Expected: Bearer <token>",
      },
      401,
    );
  }

  const token = authHeader.slice(7); // Remove 'Bearer '

  try {
    const JWKS = getJWKS(c, authUrl);
    const issuer = c.env.AUTH_SERVER;
    const audience = c.env.AUTH_SERVER;

    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience,
      algorithms: ["EdDSA"], // Better Auth uses EdDSA by default
      clockTolerance: 10,
    });

    // Check if user is banned
    if (payload.banned) {
      return c.json(
        {
          success: false,
          error: "Forbidden",
          message: payload.banReason || "Account suspended",
          banExpires: payload.banExpires,
        },
        403,
      );
    }

    // Set typed user in context
    const user = payload as unknown as User;
    c.set("user", user);
    c.set("userId", user.id);
    c.set("jwtPayload", payload);

    console.log(`[Auth] Verified: ${user.email} (${user.role})`);

    await next();
  } catch (error) {
    console.error(`[Auth] ❌ Verification failed:`, error);

    if (error instanceof errors.JOSEError) {
      // Specific JOSE errors
      const errorMap: Record<string, { status: number; message: string }> = {
        JWTExpired: {
          status: 401,
          message: "Token expired. Please sign in again.",
        },
        JWTInvalid: { status: 401, message: "Invalid token format." },
        JWSSignatureVerificationFailed: {
          status: 401,
          message: "Invalid token signature.",
        },
        JWTClaimValidationFailed: {
          status: 401,
          message: "Token claims validation failed.",
        },
      };

      const errorInfo = errorMap[error.code] || {
        status: 401,
        message: "Token verification failed.",
      };

      return c.json(
        {
          success: false,
          error: "Unauthorized",
          code: error.code,
          message: errorInfo.message,
        },
        errorInfo.status as 401 | 403,
      );
    }

    return c.json(
      {
        success: false,
        error: "InternalError",
        message: "Authentication service unavailable",
      },
      500,
    );
  }
};