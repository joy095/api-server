import { Context } from "hono";

// ─── AppError ─────────────────────────────────────────────────────────────────
export class AppError extends Error {
  constructor(
    public override message: string,
    public status: number = 400,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ─── Response helpers ─────────────────────────────────────────────────────────
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
