import type { Context, Next } from "hono";

// Wrap an async route handler so any rejection is surfaced to the global
// error handler instead of accidentally being swallowed.
export const safe = <T extends (...args: any[]) => any>(handler: T) => {
  return async (c: Context, next?: Next) => {
    try {
      // Call handler with (c, next) if it expects next, otherwise (c)
      if (handler.length >= 2) return await (handler as any)(c, next);
      return await (handler as any)(c);
    } catch (err) {
      throw err;
    }
  };
};

export default safe;
