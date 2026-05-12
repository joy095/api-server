// src/middlewares/error-handler.ts

import type { Context } from "hono";
import { AppError } from "../utils/app-error";
import type { ErrorResponse } from "../types/error";
import { HTTPException } from "hono/http-exception";

export const errorHandler = (err: unknown, c: Context): Response => {
  // ✅ AppError (fully typed)
  if (err instanceof AppError) {
    const body: ErrorResponse = {
      success: false,
      message: err.message,
      code: err.code,
      ...(err.errors.length && { errors: err.errors }),
    };

    return c.json(body, err.statusCode);
  }

  // ✅ Hono HTTPException
  if (err instanceof HTTPException) {
    const body: ErrorResponse = {
      success: false,
      message: err.message,
    };

    return c.json(body, err.status);
  }

  // ❌ Unknown error
  console.error("Unhandled error:", err);

  const body: ErrorResponse = {
    success: false,
    message: "Internal Server Error",
  };

  return c.json(body, 500);
};
