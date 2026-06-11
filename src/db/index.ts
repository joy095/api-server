import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./schema/auth-schema";
import * as orgSchema from "./schema/org-schema";
import * as docSchema from "./schema/doctor-schema";
import { Bindings } from "..";

export const createDb = (env?: Bindings | string) => {
  const databaseUrl = typeof env === "string" ? env : env?.DATABASE_URL;

  const client = postgres(databaseUrl, {
    prepare: false, // Required for Cloudflare Workers / edge environments
    max: 5,
  });

  return drizzle(client, {
    schema: { ...authSchema, ...orgSchema, ...docSchema },
  });
};
