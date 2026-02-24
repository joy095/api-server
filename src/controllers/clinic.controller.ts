import { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import { clinic } from "../db/schema/schema";
import { ok, created, noContent, paginated, AppError } from "../lib/response";
import { createDb } from "../db";
import type { z } from "zod";
import type { createClinicSchema, updateClinicSchema } from "../validators";

type CreateClinic = z.infer<typeof createClinicSchema>;
type UpdateClinic = z.infer<typeof updateClinicSchema>;

export const clinicController = {
  // GET /clinics
  list: async (c: Context) => {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = (page - 1) * limit;

    const db = createDb(c.env);

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(clinic).limit(limit).offset(offset).orderBy(clinic.name),

      db.select({ count: sql<number>`count(*)::int` }).from(clinic),
    ]);

    return paginated(c, rows, count, page, limit);
  },

  // GET /clinics/:id
  getById: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .select()
      .from(clinic)
      .where(eq(clinic.id, c.req.param("id")))
      .limit(1);

    if (!row) throw new AppError("Clinic not found", 404);
    return ok(c, row);
  },

  // POST /clinics
  create: async (c: Context) => {
    const body: CreateClinic = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db.insert(clinic).values(body).returning();

    return created(c, row);
  },

  // PATCH /clinics/:id
  update: async (c: Context) => {
    const body: UpdateClinic = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db
      .update(clinic)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(clinic.id, c.req.param("id")))
      .returning();

    if (!row) throw new AppError("Clinic not found", 404);
    return ok(c, row);
  },

  // DELETE /clinics/:id
  delete: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .delete(clinic)
      .where(eq(clinic.id, c.req.param("id")))
      .returning({ id: clinic.id });

    if (!row) throw new AppError("Clinic not found", 404);
    return noContent(c);
  },
};
