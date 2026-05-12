import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppErrorOptions, ErrorCode } from "../types/error";

export class AppError extends Error {
  readonly statusCode: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly errors: string[];
  readonly success = false as const;

  constructor({ statusCode, message, code, errors = [] }: AppErrorOptions) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;

    const E = Error as ErrorConstructor & {
      captureStackTrace?: (target: object, constructorOpt?: Function) => void;
    };

    if (E.captureStackTrace) {
      E.captureStackTrace(this, this.constructor);
    }
  }
}
