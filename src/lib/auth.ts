import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin as adminPlugin,
  bearer,
  organization,
} from "better-auth/plugins";
import { createDb } from "../db";
import type { Env } from "../types";
import * as authSchema from "../db/schema/auth-schema";
import * as appSchema from "../db/schema/schema";
// Import from the shared permissions file — NOT inline
import { ac, owner, admin, doctor, staff } from "./permissions";
import { sendEmail } from "./sendEmail";

const createAuthHandler = (env?: Env) => {
  const db = createDb(env);

  return betterAuth({
    secret: env?.BETTER_AUTH_SECRET,
    baseURL: env?.BETTER_AUTH_URL ?? "http://localhost:8787",

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { ...authSchema, ...appSchema },
    }),

    rateLimit: {
      enabled: true,
      window: 10, // time window in seconds
      max: 100, // max requests in the window
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env!, {
          to: user.email,
          subject: "Reset your password",
          text: `Click the link to reset your password: ${url}`,
        });
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env!, {
          to: user.email,
          subject: "Verify your email address",
          text: `Click the link to verify your email: ${url}`,
        });
      },
      sendOnSignIn: true,
    },

    plugins: [
      bearer(),

      organization({
        allowUserToCreateOrganization: false,
        // Correct: pass ac + role objects, not inline permission maps
        ac,
        roles: { owner, admin, doctor, staff },
      }),

      adminPlugin({
        defaultRole: "staff",
      }),
    ],

    trustedOrigins: (env?.ALLOWED_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((o) => o.trim()),

    advanced: {
      disableCSRFCheck: true,
      disableOriginCheck: true,
    },

    user: {
      additionalFields: {
        doctorId: { type: "string", nullable: true },
      },
    },
  });
};

export default createAuthHandler;
