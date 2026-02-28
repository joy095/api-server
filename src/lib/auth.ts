import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin as adminPlugin,
  bearer,
  jwt,
  openAPI,
  organization,
  multiSession,
} from "better-auth/plugins";
import { createDb } from "../db";
import type { Env } from "../types";
import * as authSchema from "../db/schema/auth-schema";
import * as appSchema from "../db/schema/schema";
import { ac, owner, admin, doctor, staff } from "./permissions";
import { sendEmail } from "./sendEmail";

/**
 * Creates a better-auth instance scoped to the current request's environment.
 *
 * Plugins in use:
 *   bearer()       — validates `Authorization: Bearer <token>` headers (session tokens)
 *   jwt()          — issues signed JWTs; GET /api/auth/token returns one for the current session
 *   openAPI()      — mounts Swagger UI at /api/auth/reference
 *   organization() — org membership, roles, invitations, setActiveOrganization
 *   multiSession() — allows one user to hold sessions in multiple orgs simultaneously
 *   adminPlugin()  — user management (ban, impersonate, list users) for global admins
 */
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
      window: 10,
      max: 100,
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
      // Session-token bearer auth — mobile clients pass the session token as Bearer
      bearer(),
      // JWT plugin — GET /api/auth/token returns a signed JWT for the current session
      jwt(),
      // Swagger docs at /api/auth/reference
      openAPI(),
      // Organisation management + RBAC
      organization({
        allowUserToCreateOrganization: true,
        ac,
        roles: { owner, admin, doctor, staff },
        // Sends invitation emails automatically
        sendInvitationEmail: async ({ invitation, inviter, organization }) => {
          await sendEmail(env!, {
            to: invitation.email,
            subject: `You've been invited to join ${organization.name}`,
            text: `${inviter.user.name} invited you to join ${organization.name}.`,
          });
        },
      }),
      // Multi-session: user can be active in multiple orgs; setActiveOrganization switches context
      multiSession(),
      // Global admin controls (ban users, impersonate, etc.)
      adminPlugin(),
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
        // Links a user account to a doctor profile row
        doctorId: { type: "string", nullable: true },
      },
    },
  });
};

export default createAuthHandler;
