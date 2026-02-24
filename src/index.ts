import { Hono } from "hono";
import createAuth from "./lib/auth";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./types";
import { cors } from "hono/cors";
import { errorHandler, requestLogger, csrfProtection } from "./middlewares";
import { doctorRoutes } from "./routes/doctor.routes";
import {
  clinicRoutes,
  patientRoutes,
  bookingRoutes,
} from "./routes/other.routes";
import { adminRoutes } from "./bookings/admin.routes";
import { sseRoutes } from "./routes/sse.routes";

const app = new Hono<{ Bindings: Env }>();

// ── Global middleware ──────────────────────────────────────────────────────────
app.use("*", requestLogger);
app.use("*", errorHandler);
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

// Skip CSRF check on SSE routes (they're GET only)
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/v1/sse")) return next();
  return csrfProtection(c, next);
});

// ── Better-auth handler ────────────────────────────────────────────────────────
// Handles /api/auth/sign-in, /api/auth/sign-out, /api/auth/session, etc.
app.all("/api/auth/**", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// ── API routes ─────────────────────────────────────────────────────────────────
const api = new Hono<{ Bindings: Env }>().basePath("/api/v1");

api.route("/doctors", doctorRoutes);
api.route("/clinics", clinicRoutes);
api.route("/patients", patientRoutes);
api.route("/bookings", bookingRoutes);
api.route("/admin", adminRoutes);
api.route("/sse", sseRoutes);

// Health check — public, no auth
api.get("/health", (c) =>
  c.json({ success: true, status: "ok", ts: new Date().toISOString() }),
);

app.route("/", api);

// ── 404 fallback ───────────────────────────────────────────────────────────────
app.notFound((c) =>
  c.json({ success: false, error: "Route not found" }, 404),
);

export default app;
