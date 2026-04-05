import { Env } from "../types";

type EmailOptions = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

type CFExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

async function doSendEmail(env: Env, options: EmailOptions): Promise<unknown> {
  if (!env.MAIL_HMAC_SECRET) {
    throw new Error("MAIL_HMAC_SECRET is missing in Worker environment");
  }

  const payload = {
    from: "no-reply@yourdomain.com",
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  const body = JSON.stringify(payload);
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.MAIL_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body),
  );

  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const res = await fetch(`${env.EMAIL_SERVER_URL}/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": signature,
    },
    body,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Mail server rejected request (${res.status}): ${errorText}`,
    );
  }

  return res.json();
}

export function sendEmail(
  env: Env,
  options: EmailOptions,
  ctx?: CFExecutionContext,
): void {
  const promise = doSendEmail(env, options).catch((err) => {
    console.error("Worker failed to send email:", err);
  });

  if (ctx) {
    ctx.waitUntil(promise);
  }
}
