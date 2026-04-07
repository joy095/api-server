import { Hono } from "hono";
import type { Env } from "./types";
import createAuth from "./lib/auth";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { csrf } from "hono/csrf";

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

// app.all("/api/auth/**", async (c) => {
//   try {
//     const auth = createAuth(c.env, c.executionCtx);
//     const res = await auth.handler(c.req.raw);
//     if (res) return res;
//     return c.json({ success: true }, 200);
//   } catch (err) {
//     const requestId = c.get("requestId") as string | undefined;
//     console.error("Better-auth handler error", {
//       err: err instanceof Error ? err.message : String(err),
//       stack: err instanceof Error ? err.stack : undefined,
//       path: c.req.path,
//       ...(requestId ? { requestId } : {}),
//     });
//     return c.json({ error: "Internal Server Error" }, 500);
//   }
// });

app.get("/", (c) => {
  return c.json({ status: "ok from backend server" }, 200);
});

export default app;
