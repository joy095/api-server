import { and, eq } from "drizzle-orm";
import { createDb } from "../db";
import { doctor, doctorClinic } from "../db/schema/schema";
import { AppError } from "../lib/response";
import type { Env } from "../types";

/**
 * Return the doctor row or throw a 404 AppError.
 */
export async function getDoctorOrThrow(id: string, env?: Env) {
  const db = createDb(env);
  const [row] = await db
    .select()
    .from(doctor)
    .where(eq(doctor.id, id))
    .limit(1);
  if (!row) throw new AppError("Doctor not found", 404);
  return row;
}

/**
 * Assert that a doctor is assigned to a clinic, throwing 409 if not.
 *
 * Fix: the original used `&&` (JS logical AND) instead of drizzle's `and()`
 * which silently evaluated to only the second condition.
 */
export async function assertDoctorInClinic(
  doctorId: string,
  clinicId: string,
  env?: Env,
): Promise<void> {
  const db = createDb(env);

  const [row] = await db
    .select({ doctorId: doctorClinic.doctorId })
    .from(doctorClinic)
    .where(
      and(
        eq(doctorClinic.doctorId, doctorId),
        eq(doctorClinic.clinicId, clinicId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new AppError(
      "Doctor is not assigned to this clinic",
      409,
      "DOCTOR_NOT_IN_CLINIC",
    );
  }
}

/**
 * Return all clinic IDs for a doctor.
 */
export async function getDoctorClinicIds(
  doctorId: string,
  env?: Env,
): Promise<string[]> {
  const db = createDb(env);
  const rows = await db
    .select({ clinicId: doctorClinic.clinicId })
    .from(doctorClinic)
    .where(eq(doctorClinic.doctorId, doctorId));
  return rows.map((r) => r.clinicId);
}
