import { and, eq } from "drizzle-orm";
import { availabilityRules, booking } from "../db/schema/schema";
import type { BreakSlot, Env } from "../types";
import { createDb } from "../db";

export type TimeSlot = {
  start: string; // "HH:MM"
  end: string;
  available: boolean;
  serial?: number;
};

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const min = (m % 60).toString().padStart(2, "0");
  return `${h}:${min}`;
}

function isDuringBreak(minute: number, breaks: BreakSlot[]): boolean {
  return breaks.some((b) => minute >= b.start && minute < b.end);
}

export async function getSlotsForDate(
  doctorId: string,
  clinicId: string,
  date: string,
  slotDurationMinutes = 15,
  env?: Env,
): Promise<TimeSlot[]> {
  const dayOfWeek = new Date(date).getDay();
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

  if (!rule?.startTime || !rule?.endTime) return [];

  const breaks = (rule.breaks ?? []) as BreakSlot[];
  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);

  const existingBookings = await db
    .select({ dailySerial: booking.dailySerial })
    .from(booking)
    .where(
      and(
        eq(booking.doctorId, doctorId),
        eq(booking.clinicId, clinicId),
        eq(booking.serialDate, date),
      ),
    );

  const bookedSerials = new Set(existingBookings.map((b) => b.dailySerial));
  const slots: TimeSlot[] = [];
  let serial = 1;

  for (
    let cursor = start;
    cursor + slotDurationMinutes <= end;
    cursor += slotDurationMinutes
  ) {
    if (isDuringBreak(cursor, breaks)) continue;
    slots.push({
      start: minutesToTime(cursor),
      end: minutesToTime(cursor + slotDurationMinutes),
      available: !bookedSerials.has(serial),
      serial,
    });
    serial++;
  }

  return slots;
}

export async function getNextAvailableDate(
  doctorId: string,
  clinicId: string,
  fromDate: string,
  maxDays = 30,
  env?: Env,
): Promise<string | null> {
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const slots = await getSlotsForDate(doctorId, clinicId, dateStr, 15, env);
    if (slots.some((s) => s.available)) return dateStr;
  }
  return null;
}
