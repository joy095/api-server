import { Resend } from "resend";
import type { Env } from "../types";

type SendEmailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export const sendEmail = async (
  env: Env,
  { to, subject, text, html }: SendEmailOptions,
) => {
  const resend = new Resend(env.RESEND_API_KEY);

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
};
