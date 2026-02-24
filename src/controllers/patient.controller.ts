import { Context } from "hono";
import { eq, sql, desc } from "drizzle-orm";
import { patients, booking } from "../db/schema/schema";
import { ok, created, noContent, paginated, AppError } from "../lib/response";
import { createDb } from "../db";
import type { z } from "zod";
import type { createPatientSchema, updatePatientSchema } from "../validators";

type CreatePatient = z.infer<typeof createPatientSchema>;
type UpdatePatient = z.infer<typeof updatePatientSchema>;

export const patientController = {
  // GET /patients
  list: async (c: Context) => {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = (page - 1) * limit;

    const db = createDb(c.env);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(patients)
        .limit(limit)
        .offset(offset)
        .orderBy(patients.name),

      db.select({ count: sql<number>`count(*)::int` }).from(patients),
    ]);

    return paginated(c, rows, count, page, limit);
  },

  // GET /patients/:id
  getById: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, c.req.param("id")))
      .limit(1);

    if (!row) throw new AppError("Patient not found", 404);
    return ok(c, row);
  },

  // GET /patients/:id/bookings
  getBookings: async (c: Context) => {
    const patientId = c.req.param("id");
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = (page - 1) * limit;

    const db = createDb(c.env);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(booking)
        .where(eq(booking.patientId, patientId))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(booking.serialDate)),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(booking)
        .where(eq(booking.patientId, patientId)),
    ]);

    return paginated(c, rows, count, page, limit);
  },

  // POST /patients
  create: async (c: Context) => {
    const body: CreatePatient = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db.insert(patients).values(body).returning();

    return created(c, row);
  },

  // PATCH /patients/:id
  update: async (c: Context) => {
    const body: UpdatePatient = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db
      .update(patients)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(patients.id, c.req.param("id")))
      .returning();

    if (!row) throw new AppError("Patient not found", 404);
    return ok(c, row);
  },

  // DELETE /patients/:id
  delete: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .delete(patients)
      .where(eq(patients.id, c.req.param("id")))
      .returning({ id: patients.id });

    if (!row) throw new AppError("Patient not found", 404);
    return noContent(c);
  },
};
