// src/types/error-codes.ts
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type AppErrorOptions = {
  statusCode: ContentfulStatusCode;
  message: string;
  code: ErrorCode;
  errors?: string[];
};

export type ErrorResponse = {
  success: false;
  message: string;
  code?: ErrorCode;
  errors?: string[];
};
