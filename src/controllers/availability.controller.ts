import { Context } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { availabilityRules, clinic } from "../db/schema/schema";
import { ok, created, noContent, AppError } from "../lib/response";
import { getDoctorOrThrow } from "../services/doctor.service";
import type { z } from "zod";
import type {
  createAvailabilityRuleSchema,
  updateAvailabilityRuleSchema,
} from "../validators";
import { createDb } from "../db";

type CreateRule = z.infer<typeof createAvailabilityRuleSchema>;
type UpdateRule = z.infer<typeof updateAvailabilityRuleSchema>;

export const availabilityController = {
  // GET /doctors/:id/availability
  listByDoctor: async (c: Context) => {
    const doctorId = c.req.param("id");
    const clinicId = c.req.query("clinicId");
    const activeOnly = c.req.query("active") !== "false";

    const conditions = [eq(availabilityRules.doctorId, doctorId)];
    if (clinicId) conditions.push(eq(availabilityRules.clinicId, clinicId));
    if (activeOnly) conditions.push(eq(availabilityRules.isActive, true));

    const db = createDb(c.env);

    const rows = await db
      .select()
      .from(availabilityRules)
      .where(and(...conditions))
      .orderBy(availabilityRules.recurrentType, availabilityRules.dayOfWeek);

    return ok(c, rows);
  },

  // GET /doctors/:id/availability/:ruleId
  getById: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .select({
        availabilityRules,
        clinic,
      })
      .from(availabilityRules)
      .leftJoin(clinic, eq(availabilityRules.clinicId, clinic.id))
      .where(
        and(
          eq(availabilityRules.doctorId, c.req.param("id")),
          eq(availabilityRules.id, c.req.param("ruleId")),
        ),
      )
      .limit(1);

    if (!row) throw new AppError("Availability rule not found", 404);

    return ok(c, row);
  },

  // POST /doctors/:id/availability
  create: async (c: Context) => {
    const doctorId = c.req.param("id");

    await getDoctorOrThrow(doctorId);

    const body: CreateRule = c.get("validatedBody");
    const db = createDb(c.env);

    // Prevent overlapping time slots for same doctor+clinic+day
    const overlapping = await db
      .select({ id: availabilityRules.id })
      .from(availabilityRules)
      .where(
        and(
          eq(availabilityRules.doctorId, doctorId),
          eq(availabilityRules.clinicId, body.clinicId),
          eq(availabilityRules.isActive, true),
          body.dayOfWeek !== undefined
            ? eq(availabilityRules.dayOfWeek, body.dayOfWeek)
            : sql`true`,
        ),
      )
      .limit(1);

    if (overlapping.length) {
      throw new AppError(
        "An active rule already exists for this doctor/clinic/day combination. Deactivate the existing rule first.",
        409,
      );
    }

    const [row] = await db
      .insert(availabilityRules)
      .values({ ...body, doctorId })
      .returning();

    return created(c, row);
  },

  // PATCH /doctors/:id/availability/:ruleId
  update: async (c: Context) => {
    const body: UpdateRule = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db
      .update(availabilityRules)
      .set(body)
      .where(
        and(
          eq(availabilityRules.id, c.req.param("ruleId")),
          eq(availabilityRules.doctorId, c.req.param("id")),
        ),
      )
      .returning();

    if (!row) throw new AppError("Availability rule not found", 404);
    return ok(c, row);
  },

  // DELETE /doctors/:id/availability/:ruleId  (soft delete)
  delete: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .update(availabilityRules)
      .set({ isActive: false })
      .where(
        and(
          eq(availabilityRules.id, c.req.param("ruleId")),
          eq(availabilityRules.doctorId, c.req.param("id")),
        ),
      )
      .returning({ id: availabilityRules.id });

    if (!row) throw new AppError("Availability rule not found", 404);
    return noContent(c);
  },
};
