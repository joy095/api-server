import { Hono } from "hono";
import type { Env } from "./types";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { csrf } from "hono/csrf";
import { verifyBetterAuthJWT } from "./middleware/auth";

const app = new Hono<{ Bindings: Env }>();

app.use("*", secureHeaders());
const isDev = (env: Env) => env.NODE_ENV === "development";

app.use("*", (c, next) => {
  if (isDev(c.env)) return logger()(c, next);
  return next();
});

// 1. Define your origins once to keep things DRY
const getOrigins = (env: Env) => {
  return env?.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173"];
};

// 2. CORS Middleware
app.use("*", async (c, next) => {
  const origins = getOrigins(c.env);
  const corsMiddleware = cors({
    origin: origins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-signature"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  return corsMiddleware(c, next);
});

// 3. CSRF Middleware
// We wrap it in a functional middleware so we can access c.env
app.use("*", async (c, next) => {
  const origins = getOrigins(c.env);
  const csrfMiddleware = csrf({
    origin: origins,
  });
  return csrfMiddleware(c, next);
});

app.get("/", (c) => {
  return c.json(
    {
      success: true,
      message: "Hono API Server",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    },
    200,
  );
});

// Apply auth to all /api/users* routes
app.use('/api/users*', verifyBetterAuthJWT)

// Current user info
app.get('/api/users/me', (c) => {
  const user = c.get('user')
  
  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      // Don't expose sensitive fields like banReason unless admin
    }
  })
})

export default {
  port: 5000,
  fetch: app.fetch,
}

