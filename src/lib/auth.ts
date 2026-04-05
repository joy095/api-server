import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  bearer,
  emailOTP,
  jwt,
  openAPI,
  organization,
} from "better-auth/plugins";

import * as authSchema from "../db/schema/auth-schema";
import { sendEmail } from "./mail";
import { Env } from "../types";
import { createDb } from "../db";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { compare, hash } from "bcrypt-ts";
import { dash, sentinel } from "@better-auth/infra";

type CFExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

function otpEmailHtml(title: string, action: string, otp: string) {
  return `
    <div style="font-family: Arial, sans-serif; padding:20px; max-width:480px">
      <h2>${title}</h2>
      <p>Use the code below to ${action}.</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:8px;
                  background:#f3f4f6;padding:16px 24px;border-radius:8px;
                  text-align:center;margin:24px 0">
        ${otp}
      </div>
      <p style="color:#6b7280;font-size:14px">
        If you did not request this, you can safely ignore this email.
      </p>
    </div>
  `;
}

export default function createAuthHandler(env?: Env, ctx?: CFExecutionContext) {
  const db = createDb(env);

  const API_URL = env?.BETTER_AUTH_URL;
  const APP_GOOGLE_ID = env?.GOOGLE_CLIENT_ID;
  const APP_GOOGLE_SECRET = env?.GOOGLE_CLIENT_SECRET;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { ...authSchema },
    }),

    rateLimit: {
      enabled: false,
      window: 60,
      max: 100,
    },

    socialProviders: {
      google: {
        clientId: APP_GOOGLE_ID,
        clientSecret: APP_GOOGLE_SECRET,
      },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,

      onSignIn: async ({ user }) => {
        if (!user.emailVerified) {
          throw new APIError("UNAUTHORIZED", {
            message: "Please verify your email before signing in.",
          });
        }
      },

      password: {
        hash: async (password) => {
          return await hash(password, 10);
        },
        verify: async ({ hash, password }) => {
          return await compare(password, hash);
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;

        const email = ctx.body?.email;
        if (!email)
          throw new APIError("BAD_REQUEST", { message: "Email is required" });

        const existingUser =
          await ctx.context.internalAdapter.findUserByEmail(email);

        if (existingUser) {
          if (existingUser.user.emailVerified) {
            throw new APIError("CONFLICT", {
              message: "This email is already in use. Try logging in instead.",
            });
          }

          await fetch(`${API_URL}/api/auth/email-otp/send-verification-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: existingUser.user.email,
              type: "email-verification",
            }),
          });

          throw new APIError("ACCEPTED", {
            message:
              "Email already registered. A new verification link has been sent to your inbox.",
          });
        }
      }),
    },

    // Triggered automatically after sign-up and on unverified sign-in.
    // We delegate to the emailOTP plugin so it generates + stores the OTP,
    // then sendVerificationOTP below actually sends the email.
    emailVerification: {
      sendVerificationEmail: async ({ user }) => {
        await fetch(`${API_URL}/api/auth/email-otp/send-verification-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: user.email,
            type: "email-verification",
          }),
        });
      },
      sendOnSignIn: true,
    },

    plugins: [
      dash(),
      sentinel({
        security: {
          // OR with custom action
          botBlocking: {
            action: "challenge", // "log", "challenge", or "block"
          },

          suspiciousIpBlocking: {
            action: "challenge",
          },

          velocity: {
            enabled: true,
            thresholds: {
              challenge: 10,
              block: 20,
            },
            maxSignupsPerVisitor: 5,
            maxPasswordResetsPerIp: 10,
            maxSignInsPerIp: 50,
            windowSeconds: 3600,
            action: "challenge",
          },

          challengeDifficulty: 18, // Default difficulty level

          credentialStuffing: {
            enabled: true,
            thresholds: {
              challenge: 3, // Issue PoW challenge after 3 failures
              block: 5, // Block after 5 failures
            },
            windowSeconds: 3600, // 1 hour window
            cooldownSeconds: 900, // 15 minute cooldown after block
          },

          impossibleTravel: {
            enabled: true,
            maxSpeedKmh: 1000, // Max realistic travel speed
            action: "challenge", // "log", "challenge", or "block"
          },

          staleUsers: {
            enabled: true,
            staleDays: 90, // Account considered stale after 90 days
            action: "log", // "log", "challenge", or "block"
            notifyUser: true, // Send email to user
            notifyAdmin: true, // Send email to admin
            adminEmail: "admin@yourapp.com",
          },
        },
      }),

      bearer(),
      openAPI(),
      admin(),
      jwt({
        jwks: {
          keyPairConfig: {
            alg: "EdDSA",
          },
          // Rotate signing keys every 30 days
          rotationInterval: 60 * 60 * 24 * 30, // 30 days
          // Keep old keys valid for 30 days to verify existing tokens
          gracePeriod: 60 * 60 * 24 * 30, // 30 days
          // Or set gracePeriod = your max session lifetime
        },
        jwt: {
          // JWT token expires in 15 minutes (default)
          expirationTime: "15m",
          // Or longer if your use case requires it
          // expirationTime: "1h"
        },
      }),

      emailOTP({
        otpLength: 6,
        expiresIn: 300,

        // This is the ONLY place OTPs are generated and stored by better-auth.
        // All flows funnel here so the stored OTP always matches what's emailed.
        async sendVerificationOTP({ email, otp, type }) {
          const configs: Record<string, { subject: string; action: string }> = {
            "sign-in": { subject: "Your sign-in code", action: "sign in" },
            "email-verification": {
              subject: "Verify your email",
              action: "verify your email",
            },
            "forget-password": {
              subject: "Reset your password",
              action: "reset your password",
            },
          };

          const { subject, action } = configs[type] ?? configs["sign-in"];

          sendEmail(
            env!,
            {
              to: email,
              subject,
              text: `Your code is: ${otp}.`,
              html: otpEmailHtml(subject, action, otp),
            },
            ctx, // non-blocking via waitUntil
          );
        },
      }),

      organization({
        allowUserToCreateOrganization: true,
        requireEmailVerificationOnInvitation: true,
        membershipLimit: 5,

        teams: {
          enabled: true,
        },

        sendInvitationEmail: async ({ invitation, inviter, organization }) => {
          sendEmail(
            env!,
            {
              to: invitation.email,
              subject: `You've been invited to join ${organization.name}`,
              text: `${inviter.user.name} invited you to join ${organization.name}.`,
              html: `
                <div style="font-family: Arial, sans-serif; padding:20px">
                  <h2>Organization Invitation</h2>
                  <p>${inviter.user.name} invited you to join
                  <strong>${organization.name}</strong>.</p>
                  <p>
                    <a href="${invitation.url}"
                       style="background:#2563eb;color:white;padding:10px 16px;text-decoration:none;border-radius:6px">
                       Accept Invitation
                    </a>
                  </p>
                </div>
              `,
            },
            ctx, // non-blocking via waitUntil
          );
        },
      }),
    ],

    trustedOrigins: (
      env?.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:8081"
    )
      .split(",")
      .map((o) => o.trim()),

    advanced: {
      disableCSRFCheck: true,
      disableOriginCheck: true,
    },
  });
}
