import { and, eq, sql } from "drizzle-orm";
import { booking, availabilityRules } from "../db/schema/schema";
import { AppError } from "../lib/response";
import { timeToMinutes } from "./availability.service";
import type { BreakSlot } from "../types";
import { createDb } from "../db";
import type { Env } from "../types";

/**
 * Atomically allocate the next daily serial number for a doctor+date.
 *
 * MUST be called inside a transaction (tx) to prevent race conditions.
 * The SELECT ... FOR UPDATE ensures no two concurrent requests grab the same serial.
 */
export async function allocateSerial(
  tx: Parameters<Parameters<ReturnType<typeof createDb>["transaction"]>[0]>[0],
  doctorId: string,
  serialDate: string,
): Promise<number> {
  const [result] = await tx.execute(sql`
    SELECT COALESCE(MAX(daily_serial), 0) + 1 AS next_serial
    FROM booking
    WHERE doctor_id  = ${doctorId}
      AND serial_date = ${serialDate}::date
    FOR UPDATE
  `);
  return Number((result as any).next_serial);
}

/**
 * Validate that a booking request falls within the doctor's active availability
 * window for that clinic and date.  Throws AppError if not valid.
 */
export async function assertWithinAvailability(
  doctorId: string,
  clinicId: string,
  serialDate: string,
  scheduledAt?: Date,
  env?: Env,
): Promise<void> {
  const dayOfWeek = new Date(serialDate).getDay();
  const db = createDb(env);

  const [rule] = await db
    .select()
    .from(availabilityRules)
    .where(
      and(
        eq(availabilityRules.doctorId, doctorId),
        eq(availabilityRules.clinicId, clinicId),
        eq(availabilityRules.isActive, true),
        eq(availabilityRules.dayOfWeek, dayOfWeek),
      ),
    )
    .limit(1);

  if (!rule) {
    throw new AppError(
      "Doctor is not available at this clinic on the requested date",
      409,
      "NO_AVAILABILITY",
    );
  }

  // If a specific time was provided, check it falls inside the window
  if (scheduledAt && rule.startTime && rule.endTime) {
    const requestedMinutes =
      scheduledAt.getUTCHours() * 60 + scheduledAt.getUTCMinutes();
    const start = timeToMinutes(rule.startTime);
    const end = timeToMinutes(rule.endTime);
    const breaks = (rule.breaks ?? []) as BreakSlot[];

    if (requestedMinutes < start || requestedMinutes >= end) {
      throw new AppError(
        `Scheduled time is outside doctor availability (${rule.startTime}–${rule.endTime})`,
        409,
        "OUTSIDE_HOURS",
      );
    }

    const duringBreak = breaks.some(
      (b) => requestedMinutes >= b.start && requestedMinutes < b.end,
    );
    if (duringBreak) {
      throw new AppError(
        "Scheduled time falls within a break period",
        409,
        "DURING_BREAK",
      );
    }
  }
}

/**
 * Valid booking status values and allowed state-machine transitions.
 */
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function assertValidTransition(
  current: BookingStatus,
  next: BookingStatus,
): void {
  const allowed = ALLOWED_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new AppError(
      `Cannot transition booking from "${current}" to "${next}"`,
      409,
      "INVALID_TRANSITION",
    );
  }
}

/**
 * Return the current booking or throw 404.
 */
export async function getBookingOrThrow(id: string, env?: Env) {
  const db = createDb(env);
  const [row] = await db
    .select()
    .from(booking)
    .where(eq(booking.id, id))
    .limit(1);
  if (!row) throw new AppError("Booking not found", 404);
  return row;
}
