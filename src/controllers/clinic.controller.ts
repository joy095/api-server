import { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and } from "drizzle-orm";
import { createDb } from "../db";
import {
  doctorAvailability,
  doctorAvailabilityTemplate,
} from "../db/schema/org-schema";
import { Bindings } from "..";
import { doctor } from "../db/schema/doctor-schema";
import { notFound } from "../utils/errors";

type AppEnv = { Bindings: Bindings };

// ─── Helper: assert caller is the doctor or org owner ─────────────────────────

async function assertDoctorOrOwner(
  db: ReturnType<typeof createDb>,
  session: any,
  doctorId: string,
) {
  const doctorRows = await db
    .select()
    .from(doctor)
    .where(eq(doctor.id, doctorId))
    .limit(1);

  if (!doctorRows.length) {
    throw notFound("Doctor not found");
  }

  const isDoctor = doctorRows[0].userId === (session.userId as string);
  const isOwner =
    (session.activeOrganizationRole as string | undefined) === "owner";

  if (!isDoctor && !isOwner) {
    throw new HTTPException(403, {
      message: "Only the clinic owner or the doctor can perform this action",
    });
  }

  return doctorRows[0];
}

// ─── Availability Instance (daily resolved slots) ─────────────────────────────

export async function createAvailability(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const body = c.req.valid("json" as never) as any;

  await assertDoctorOrOwner(db, session, body.doctorId);

  const [existing] = await db
    .select()
    .from(doctorAvailability)
    .where(
      and(
        eq(doctorAvailability.doctorId, body.doctorId),
        eq(doctorAvailability.date, body.date),
        eq(doctorAvailability.startTime, body.startTime),
      ),
    )
    .limit(1);

  if (existing) {
    return c.json({ success: true, availability: existing }, 200);
  }

  const [availability] = await db
    .insert(doctorAvailability)
    .values({
      doctorId: body.doctorId,
      organizationId: body.organizationId,
      templateId: body.templateId ?? null,
      date: body.date,
      segment: body.segment,
      startTime: body.startTime,
      endTime: body.endTime ?? null,
      maxCapacity: body.maxCapacity ?? null,
    })
    .returning();

  return c.json({ success: true, availability }, 201);
}

export async function getAvailability(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const doctorId = c.req.param("doctorId");
  const date = c.req.param("date");

  if (!doctorId || !date) {
    throw notFound("Doctor ID and date are required");
  }

  const rows = await db
    .select()
    .from(doctorAvailability)
    .where(
      and(
        eq(doctorAvailability.doctorId, doctorId),
        eq(doctorAvailability.date, date),
      ),
    );

  return c.json({ success: true, availabilities: rows });
}

export async function cancelAvailability(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const id = c.req.param("id");

  if (!id) {
    throw notFound("Availability ID is required");
  }

  const rows = await db
    .select()
    .from(doctorAvailability)
    .where(eq(doctorAvailability.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Availability not found" });
  }

  await assertDoctorOrOwner(db, session, rows[0].doctorId);

  const [updated] = await db
    .update(doctorAvailability)
    .set({ isCancelled: true })
    .where(eq(doctorAvailability.id, id))
    .returning();

  return c.json({ success: true, availability: updated });
}

// ─── Queue management ─────────────────────────────────────────────────────────

export async function advanceQueue(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const { availabilityId } = c.req.valid("json" as never) as any;

  const rows = await db
    .select()
    .from(doctorAvailability)
    .where(eq(doctorAvailability.id, availabilityId))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Availability not found" });
  }

  const slot = rows[0];
  await assertDoctorOrOwner(db, session, slot.doctorId);

  if (slot.currentNumber >= slot.lastNumber) {
    throw new HTTPException(400, { message: "No more patients in the queue" });
  }

  const [updated] = await db
    .update(doctorAvailability)
    .set({ currentNumber: slot.currentNumber + 1 })
    .where(eq(doctorAvailability.id, availabilityId))
    .returning();

  return c.json({ success: true, availability: updated });
}

export async function resetQueue(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const { availabilityId } = c.req.valid("json" as never) as any;

  const rows = await db
    .select()
    .from(doctorAvailability)
    .where(eq(doctorAvailability.id, availabilityId))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Availability not found" });
  }

  await assertDoctorOrOwner(db, session, rows[0].doctorId);

  const [updated] = await db
    .update(doctorAvailability)
    .set({ currentNumber: 0, lastNumber: 0 })
    .where(eq(doctorAvailability.id, availabilityId))
    .returning();

  return c.json({ success: true, availability: updated });
}

// ─── Availability Templates ───────────────────────────────────────────────────

export async function createAvailabilityTemplate(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const body = c.req.valid("json" as never) as any;

  await assertDoctorOrOwner(db, session, body.doctorId);

  const [template] = await db
    .insert(doctorAvailabilityTemplate)
    .values({
      doctorId: body.doctorId,
      organizationId: body.organizationId,
      pattern: body.pattern,
      dayOfWeek: body.dayOfWeek ?? null,
      dayOfMonth: body.dayOfMonth ?? null,
      segment: body.segment,
      startTime: body.startTime,
      endTime: body.endTime ?? null,
      maxCapacity: body.maxCapacity ?? null,
      isActive: body.isActive ?? true,
    })
    .returning();

  return c.json({ success: true, template }, 201);
}

export async function getAvailabilityTemplates(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const doctorId = c.req.param("doctorId");

  if (!doctorId) {
    throw notFound("Doctor ID is required");
  }

  const templates = await db
    .select()
    .from(doctorAvailabilityTemplate)
    .where(eq(doctorAvailabilityTemplate.doctorId, doctorId));

  return c.json({ success: true, templates });
}

export async function updateAvailabilityTemplate(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const id = c.req.param("id");
  const body = c.req.valid("json" as never) as any;

  if (!id) {
    throw notFound("Doctor template ID is required");
  }

  const rows = await db
    .select()
    .from(doctorAvailabilityTemplate)
    .where(eq(doctorAvailabilityTemplate.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Template not found" });
  }

  await assertDoctorOrOwner(db, session, rows[0].doctorId);

  const [updated] = await db
    .update(doctorAvailabilityTemplate)
    .set({
      pattern: body.pattern,
      dayOfWeek: body.dayOfWeek ?? null,
      dayOfMonth: body.dayOfMonth ?? null,
      segment: body.segment,
      startTime: body.startTime,
      endTime: body.endTime ?? null,
      maxCapacity: body.maxCapacity ?? null,
      isActive: body.isActive,
    })
    .where(eq(doctorAvailabilityTemplate.id, id))
    .returning();

  return c.json({ success: true, template: updated });
}

export async function deleteAvailabilityTemplate(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const id = c.req.param("id");

  if (!id) {
    throw notFound("Doctor template ID is required");
  }

  const rows = await db
    .select()
    .from(doctorAvailabilityTemplate)
    .where(eq(doctorAvailabilityTemplate.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Template not found" });
  }

  await assertDoctorOrOwner(db, session, rows[0].doctorId);

  await db
    .delete(doctorAvailabilityTemplate)
    .where(eq(doctorAvailabilityTemplate.id, id));

  return c.json({ success: true, message: "Template deleted" });
}
