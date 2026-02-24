import { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { appointmentTypes } from "../db/schema/schema";
import { ok, created, noContent, AppError } from "../lib/response";
import { createDb } from "../db";
import { getDoctorOrThrow } from "../services/doctor.service";
import type { z } from "zod";
import type {
  createAppointmentTypeSchema,
  updateAppointmentTypeSchema,
} from "../validators";

type CreateAppointmentType = z.infer<typeof createAppointmentTypeSchema>;
type UpdateAppointmentType = z.infer<typeof updateAppointmentTypeSchema>;

export const appointmentTypeController = {
  // GET /doctors/:id/appointment-types
  listByDoctor: async (c: Context) => {
    const doctorId = c.req.param("id");

    const db = createDb(c.env);

    const rows = await db
      .select()
      .from(appointmentTypes)
      .where(eq(appointmentTypes.doctorId, doctorId))
      .orderBy(appointmentTypes.name);

    return ok(c, rows);
  },

  // POST /doctors/:id/appointment-types
  create: async (c: Context) => {
    const doctorId = c.req.param("id");
    const body: CreateAppointmentType = c.get("validatedBody");

    await getDoctorOrThrow(doctorId);

    const db = createDb(c.env);

    const [row] = await db
      .insert(appointmentTypes)
      .values({ ...body, doctorId })
      .returning();

    return created(c, row);
  },

  // PATCH /doctors/:id/appointment-types/:typeId
  update: async (c: Context) => {
    const doctorId = c.req.param("id");
    const typeId = c.req.param("typeId");
    const body: UpdateAppointmentType = c.get("validatedBody");

    const db = createDb(c.env);

    const [row] = await db
      .update(appointmentTypes)
      .set(body)
      .where(
        and(
          eq(appointmentTypes.id, typeId),
          eq(appointmentTypes.doctorId, doctorId),
        ),
      )
      .returning();

    if (!row) throw new AppError("Appointment type not found", 404);
    return ok(c, row);
  },

  // DELETE /doctors/:id/appointment-types/:typeId
  delete: async (c: Context) => {
    const doctorId = c.req.param("id");
    const typeId = c.req.param("typeId");

    const db = createDb(c.env);

    const [row] = await db
      .delete(appointmentTypes)
      .where(
        and(
          eq(appointmentTypes.id, typeId),
          eq(appointmentTypes.doctorId, doctorId),
        ),
      )
      .returning({ id: appointmentTypes.id });

    if (!row) throw new AppError("Appointment type not found", 404);
    return noContent(c);
  },
};
