import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { verifyBetterAuthJWT } from "./middleware/authMiddleware";
import getFile from "./routes/fileRoute";
import userImage from "./routes/userImageRoute";
import orgImage from "./routes/organizationImageRoute";

export type Bindings = {
  R2_BUCKET: R2Bucket;
  DATABASE_URL: string;
  ALLOWED_ORIGINS: string;
  NODE_ENV: string;
  AUTH_SERVER: string;
};

const app = new Hono<{ Bindings: Bindings }>();

/* ------------------ ENV HELPERS ------------------ */

const isDev = (env: Bindings) => env.NODE_ENV === "development";

const getOrigins = (env: Bindings) => {
  return env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173"];
};

/* ------------------ GLOBAL MIDDLEWARE ------------------ */

app.use("*", secureHeaders());

app.use("*", (c, next) => {
  if (isDev(c.env)) return logger()(c, next);
  return next();
});

app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: getOrigins(c.env),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-signature"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  return corsMiddleware(c, next);
});

/* Apply CSRF ONLY to API routes (not files) */
// app.use("/api/*", async (c, next) => {
//   const csrfMiddleware = csrf({
//     origin: getOrigins(c.env),
//   });
//   return csrfMiddleware(c, next);
// });

/* ------------------ HEALTH ------------------ */

app.get("/", (c) => {
  return c.json({
    success: true,
    message: "Hono API Server",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

/* ------------------ AUTH ROUTES ------------------ */

app.use("/api/users/*", verifyBetterAuthJWT);

app.get("/api/users/me", (c) => {
  const user = c.get("user");

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    },
  });
});

// protected — add verifyBetterAuthJWT before the route
// app.use("/api/uploads/*", verifyBetterAuthJWT);
app.route("/api/uploads", getFile);

app.route("/api/user/image", userImage);

app.route("/api/org/image", orgImage);

/* ------------------ EXPORT ------------------ */

export default {
  fetch: app.fetch,
};
