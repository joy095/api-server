/**
 * Environment variables configuration
 */

export const env = {
  NODE_ENV:
    (typeof process === "undefined" ? "development" : process.env.NODE_ENV) ??
    "development",
  DEBUG: typeof process === "undefined" ? false : process.env.DEBUG === "true",
};
