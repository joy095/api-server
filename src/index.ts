import { Hono } from "hono";
import createAuth from "./lib/auth";
import { logger } from "./lib/logger";
import { Errors, errorResponse } from "./lib/response";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./types";
import { cors } from "hono/cors";
import {
  errorHandler,
  requestLogger,
  csrfProtection,
  attachRequestId,
} from "./middlewares";
import { doctorRoutes } from "./routes/doctor.routes";
import {
  clinicRoutes,
  patientRoutes,
  bookingRoutes,
} from "./routes/other.routes";
import { adminRoutes } from "./routes/admin.routes";
import { sseRoutes } from "./routes/sse.routes";
import { authTokenRoutes } from "./routes/auth.routes";
const app = new Hono<{ Bindings: Env }>();

let authInstance: ReturnType<typeof createAuth>;

// ── Global middleware ──────────────────────────────────────────────────────────
// 1. Request ID must be first — errorHandler reads it for correlation
app.use("*", attachRequestId);
// 2. Error handler wraps everything downstream
app.use("*", errorHandler);
app.use("*", requestLogger);
app.use("*", secureHeaders());

// Dynamic CORS from env
app.use("*", async (c, next) => {
  const allowedOrigins = c.env?.ALLOWED_ORIGINS
    ? c.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173"];

  return cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })(c, next);
});

// Skip CSRF check on SSE routes (GET only) and token auth routes
app.use("*", async (c, next) => {
  if (
    c.req.path.startsWith("/api/v1/sse") ||
    c.req.path.startsWith("/api/v1/auth")
  ) {
    return next();
  }
  return csrfProtection(c, next);
});

// ── Better-auth handler ────────────────────────────────────────────────────────
// Handles /api/auth/sign-in, /api/auth/sign-out, /api/auth/session, etc.
app.all("/api/auth/**", async (c) => {
  try {
    const auth = createAuth(c.env);
    const res = await auth.handler(c.req.raw);
    if (res) return res;
    return c.json({ success: true }, 200);
  } catch (err) {
    const requestId: string | undefined = c.get("requestId");
    logger.error("Better-auth handler error", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      path: c.req.path,
      ...(requestId ? { requestId } : {}),
    });
    return errorResponse(
      c,
      Errors.internal("Authentication service error", {
        hint: requestId ? `Reference ID: ${requestId}` : undefined,
      }),
      requestId,
    );
  }
});

// ── API routes ─────────────────────────────────────────────────────────────────
const api = new Hono<{ Bindings: Env }>().basePath("/api/v1");

// Web session endpoint — used by browser clients only.
// Mobile clients should use POST /api/v1/auth/token instead.

api.route("/doctors", doctorRoutes);
api.route("/clinics", clinicRoutes);
api.route("/patients", patientRoutes);
api.route("/bookings", bookingRoutes);
api.route("/admin", adminRoutes);
api.route("/sse", sseRoutes);
// Mobile token-based auth endpoints:
//   POST /api/v1/auth/token    — sign in → JWT
//   POST /api/v1/auth/refresh  — refresh JWT
//   GET  /api/v1/auth/me       — current user profile
api.route("/auth", authTokenRoutes);

// Health check — public, no auth
api.get("/health", (c) =>
  c.json({ success: true, status: "ok", ts: new Date().toISOString() }),
);

app.route("/", api);

// ── 404 fallback ───────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ success: false, error: "Route not found" }, 404));

export default app;

// Register process-level handlers to avoid unhandled exceptions crashing the
// server in non-Cloudflare (Node) environments. Guard them so Worker envs
// that don't provide `process` won't fail during module import.
if (typeof process !== "undefined" && (process as any).on) {
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Rejection", { reason });
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught Exception", { err });
  });
}
