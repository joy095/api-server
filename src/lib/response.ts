/**
 * Response helpers & AppError
 *
 * Every error response follows a consistent envelope:
 *
 *   {
 *     "success": false,
 *     "error": {
 *       "code":      "VALIDATION_ERROR",          // machine-readable
 *       "message":   "Validation failed",          // human-readable summary
 *       "hint":      "Check the `fields` object",  // optional guidance
 *       "fields":    { "email": ["Invalid email"] },// validation detail
 *       "requestId": "req_abc123"                  // correlates with server logs
 *     }
 *   }
 *
 * Success responses:
 *
 *   { "success": true, "data": <T> }
 *   { "success": true, "data": [...], "meta": { total, page, limit, pages } }
 */

import { Context } from "hono";

// ─── AppError ─────────────────────────────────────────────────────────────────

export interface AppErrorOptions {
  /** Machine-readable error code (e.g. "NOT_FOUND", "VALIDATION_ERROR") */
  code?: string;
  /** Short human-readable hint to help the caller fix the issue */
  hint?: string;
  /** Field-level validation errors: { fieldName: string[] } */
  fields?: Record<string, string[]>;
  /** Extra structured data to attach to the log (never sent to the client) */
  logContext?: Record<string, unknown>;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly hint?: string;
  public readonly fields?: Record<string, string[]>;
  public readonly logContext?: Record<string, unknown>;

  constructor(
    message: string,
    status = 400,
    options: AppErrorOptions | string = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;

    // Backwards-compat: third arg used to be a raw code string
    if (typeof options === "string") {
      this.code = options || httpCodeFor(status);
    } else {
      this.code = options.code ?? httpCodeFor(status);
      this.hint = options.hint;
      this.fields = options.fields;
      this.logContext = options.logContext;
    }
  }
}

/** Derive a sensible default code from an HTTP status. */
function httpCodeFor(status: number): string {
  const MAP: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    410: "GONE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    502: "BAD_GATEWAY",
    503: "SERVICE_UNAVAILABLE",
  };
  return MAP[status] ?? "ERROR";
}

// ─── Error response builder ───────────────────────────────────────────────────

/**
 * Serialise an AppError into the standard client envelope.
 * `requestId` is threaded in from the request context so logs can be correlated.
 */
export const errorResponse = (
  c: Context,
  err: AppError,
  requestId?: string,
) => {
  const body: Record<string, unknown> = {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      ...(err.hint    ? { hint: err.hint }       : {}),
      ...(err.fields  ? { fields: err.fields }   : {}),
      ...(requestId   ? { requestId }             : {}),
    },
  };
  return c.json(body, err.status as any);
};

// ─── Success response helpers ─────────────────────────────────────────────────

export const ok = <T>(c: Context, data: T, status = 200) =>
  c.json({ success: true, data }, status as any);

export const created = <T>(c: Context, data: T) => ok(c, data, 201);

export const noContent = (c: Context) => c.body(null, 204);

export const paginated = <T>(
  c: Context,
  data: T[],
  total: number,
  page: number,
  limit: number,
) =>
  c.json({
    success: true,
    data,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });

// ─── Typed factory shortcuts ──────────────────────────────────────────────────
// Use these instead of `new AppError(...)` to get consistent codes + hints.

export const Errors = {
  badRequest:     (msg: string, opts?: Omit<AppErrorOptions, "code">) =>
    new AppError(msg, 400, { code: "BAD_REQUEST",      ...opts }),

  unauthorized:   (msg = "Authentication required", opts?: Omit<AppErrorOptions, "code">) =>
    new AppError(msg, 401, { code: "UNAUTHORIZED",     ...opts }),

  forbidden:      (msg = "You do not have permission to perform this action", opts?: Omit<AppErrorOptions, "code">) =>
    new AppError(msg, 403, { code: "FORBIDDEN",        ...opts }),

  notFound:       (resource: string, opts?: Omit<AppErrorOptions, "code">) =>
    new AppError(`${resource} not found`, 404, { code: "NOT_FOUND", ...opts }),

  conflict:       (msg: string, opts?: Omit<AppErrorOptions, "code">) =>
    new AppError(msg, 409, { code: "CONFLICT",         ...opts }),

  validation:     (fields: Record<string, string[]>, msg = "Validation failed") =>
    new AppError(msg, 422, {
      code: "VALIDATION_ERROR",
      hint: "Fix the errors in `fields` and resubmit",
      fields,
    }),

  rateLimited:    (msg = "Too many requests — please slow down", opts?: Omit<AppErrorOptions, "code">) =>
    new AppError(msg, 429, { code: "RATE_LIMITED",     ...opts }),

  internal:       (msg = "An unexpected error occurred", opts?: Omit<AppErrorOptions, "code">) =>
    new AppError(msg, 500, { code: "INTERNAL_ERROR",   ...opts }),
};
