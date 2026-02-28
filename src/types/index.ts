export interface Env {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Secret used to sign/verify mobile JWT tokens */
  JWT_SECRET: string;
  /** JWT expiry duration, e.g. "7d", "24h" (default: "7d") */
  JWT_EXPIRES_IN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ALLOWED_ORIGINS: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  /**
   * Directory where server logs are written (Node.js only).
   * Defaults to ./logs relative to process.cwd().
   * Set LOG_DIR=/var/log/myapp in production.
   */
  LOG_DIR?: string;
}

export interface BreakSlot {
  start: number; // minutes since midnight
  end: number;
}

export interface AvailabilityRule {
  id: string;
  doctorId: string;
  clinicId: string;
  recurrentType: "daily" | "weekly" | "monthly";
  dayOfWeek?: number;
  dayOfMonth?: number;
  startTime: string;
  endTime: string;
  breaks?: BreakSlot[];
  isActive: boolean;
  createdAt: Date;
}

/**
 * The shape stored in Hono context after authentication.
 * Reflects the currently active organization membership.
 */
export interface AuthUser {
  /** better-auth user id */
  id: string;
  name: string;
  email: string;
  /** Global role (set by admin plugin) */
  globalRole?: string | null;
  /** Organisation-scoped role from the member table */
  role: OrgRole;
  /** Active organisation id from the session */
  organizationId: string | null;
  /** Linked doctor profile id (set when role = "doctor") */
  doctorId?: string | null;
}

/** Roles that exist within an organisation */
export type OrgRole = "owner" | "admin" | "doctor" | "staff" | "member";
