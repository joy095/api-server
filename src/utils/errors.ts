// src/utils/errors.ts
import { AppError } from "./app-error";
import { ERROR_CODES } from "../types/error";

export const notFound = (message = "Resource not found") =>
  new AppError({
    statusCode: 404,
    message,
    code: ERROR_CODES.NOT_FOUND,
  });

export const badRequest = (message = "Bad request", errors?: string[]) =>
  new AppError({
    statusCode: 400,
    message,
    code: ERROR_CODES.BAD_REQUEST,
    errors,
  });

export const unauthorized = (message = "Unauthorized") =>
  new AppError({
    statusCode: 401,
    message,
    code: ERROR_CODES.UNAUTHORIZED,
  });

export const forbidden = (message = "Forbidden") =>
  new AppError({
    statusCode: 403,
    message,
    code: ERROR_CODES.FORBIDDEN,
  });
