import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  bearer,
  emailOTP,
  openAPI,
  organization,
} from "better-auth/plugins";

import * as authSchema from "../db/schema/auth-schema";
import { sendEmail } from "./mail";
import { Env } from "../types";
import { createDb } from "../db";
import { APIError, createAuthMiddleware } from "better-auth/api";

// Shared OTP email template
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

export default function createAuthHandler(env?: Env) {
  const db = createDb(env);

  const API_URL = env?.BETTER_AUTH_URL ?? "http://localhost:8787";

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { ...authSchema },
    }),

    rateLimit: {
      enabled: false, // Need to be set true on prod
      window: 60, // time window in seconds
      max: 100, // max requests in the window
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
          // Verified user: block and redirect to login
          if (existingUser.user.emailVerified) {
            throw new APIError("CONFLICT", {
              message: "This email is already in use. Try logging in instead.",
            });
          }

          // Unverified user: resend OTP and block sign-up
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

        // No existing user — allow sign-up to proceed normally
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
      bearer(),
      openAPI(),
      admin(),

      emailOTP({
        otpLength: 6,
        expiresIn: 300, // 5 minutes

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

          await sendEmail(env!, {
            to: email,
            subject,
            text: `Your code is: ${otp}.`,
            html: otpEmailHtml(subject, action, otp),
          });
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
          await sendEmail(env!, {
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
          });
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
