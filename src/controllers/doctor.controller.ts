import { Context } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { doctor, doctorClinic } from "../db/schema/schema";
import { ok, created, noContent, paginated, AppError } from "../lib/response";
import { createDb } from "../db";
import { getDoctorOrThrow } from "../services/doctor.service";
import type { z } from "zod";
import type {
  createDoctorSchema,
  updateDoctorSchema,
  assignDoctorClinicSchema,
} from "../validators";

type CreateDoctor = z.infer<typeof createDoctorSchema>;
type UpdateDoctor = z.infer<typeof updateDoctorSchema>;
type AssignClinic = z.infer<typeof assignDoctorClinicSchema>;

export const doctorController = {
  // GET /doctors
  list: async (c: Context) => {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = (page - 1) * limit;

    const db = createDb(c.env);

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(doctor).limit(limit).offset(offset).orderBy(doctor.name),

      db.select({ count: sql<number>`count(*)::int` }).from(doctor),
    ]);

    return paginated(c, rows, count, page, limit);
  },

  // GET /doctors/:id
  getById: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .select()
      .from(doctor)
      .where(eq(doctor.id, c.req.param("id")))
      .limit(1);

    if (!row) throw new AppError("Doctor not found", 404);
    return ok(c, row);
  },

  // POST /doctors
  create: async (c: Context) => {
    const body: CreateDoctor = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db.insert(doctor).values(body).returning();

    return created(c, row);
  },

  // PATCH /doctors/:id
  update: async (c: Context) => {
    const body: UpdateDoctor = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db
      .update(doctor)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(doctor.id, c.req.param("id")))
      .returning();

    if (!row) throw new AppError("Doctor not found", 404);
    return ok(c, row);
  },

  // DELETE /doctors/:id
  delete: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .delete(doctor)
      .where(eq(doctor.id, c.req.param("id")))
      .returning({ id: doctor.id });

    if (!row) throw new AppError("Doctor not found", 404);
    return noContent(c);
  },

  // POST /doctors/:id/clinics
  assignClinic: async (c: Context) => {
    const doctorId = c.req.param("id");
    const body: AssignClinic = c.get("validatedBody");

    await getDoctorOrThrow(doctorId);

    const db = createDb(c.env);

    // Check if assignment already exists
    const existing = await db
      .select()
      .from(doctorClinic)
      .where(
        and(
          eq(doctorClinic.doctorId, doctorId),
          eq(doctorClinic.clinicId, body.clinicId),
        ),
      )
      .limit(1);

    if (existing.length) {
      throw new AppError("Doctor is already assigned to this clinic", 409);
    }

    const [row] = await db
      .insert(doctorClinic)
      .values({ doctorId, clinicId: body.clinicId })
      .returning();

    return created(c, row);
  },

  // DELETE /doctors/:id/clinics/:clinicId
  removeClinic: async (c: Context) => {
    const doctorId = c.req.param("id");
    const clinicId = c.req.param("clinicId");

    const db = createDb(c.env);

    const [row] = await db
      .delete(doctorClinic)
      .where(
        and(
          eq(doctorClinic.doctorId, doctorId),
          eq(doctorClinic.clinicId, clinicId),
        ),
      )
      .returning();

    if (!row) throw new AppError("Assignment not found", 404);
    return noContent(c);
  },
};
