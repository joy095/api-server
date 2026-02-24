import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../types";
import * as authSchema from "./schema/auth-schema";
import * as appSchema from "./schema/schema";

export const createDb = (env?: Env | string) => {
  const databaseUrl = typeof env === "string" ? env : env?.DATABASE_URL;

  // if (!databaseUrl) {
  //   throw new Error("DATABASE_URL is required");
  // }

  const client = postgres(databaseUrl, {
    prepare: false, // Required for Cloudflare Workers / edge environments
    max: 5,
  });

  return drizzle(client, {
    schema: { ...authSchema, ...appSchema },
  });
};
