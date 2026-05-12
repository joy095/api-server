// utils/v.ts
import { sValidator } from "@hono/standard-validator";
import { handleValidationError } from "./validationError";

export const validateBody = (schema: any) =>
  sValidator("json", schema, handleValidationError);

export const validateQuery = (schema: any) =>
  sValidator("query", schema, handleValidationError);
