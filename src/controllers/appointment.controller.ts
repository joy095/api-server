import { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, sql } from "drizzle-orm";
import { createDb } from "../db";
import { appointment, doctorAvailability } from "../db/schema/org-schema";
import { Bindings } from "..";
import { doctor } from "../db/schema/doctor-schema";

type AppEnv = { Bindings: Bindings };

export async function createAppointment(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const patientId = session.userId as string;
  const body = c.req.valid("json" as never) as any;

  // availabilityId must be provided by the client (resolved from template or direct)
  const availabilityRows = await db
    .select()
    .from(doctorAvailability)
    .where(eq(doctorAvailability.id, body.availabilityId))
    .limit(1);

  if (!availabilityRows.length) {
    throw new HTTPException(404, { message: "Availability slot not found" });
  }

  const availability = availabilityRows[0];

  if (availability.isCancelled) {
    throw new HTTPException(400, {
      message: "This availability slot has been cancelled",
    });
  }

  if (
    availability.maxCapacity !== null &&
    availability.lastNumber >= availability.maxCapacity
  ) {
    throw new HTTPException(400, { message: "This slot is fully booked" });
  }

  // Atomically increment lastNumber and use it as the booking number
  const [updatedAvailability] = await db
    .update(doctorAvailability)
    .set({ lastNumber: sql<number>`last_number + 1` })
    .where(eq(doctorAvailability.id, availability.id))
    .returning();

  const bookingNumber = updatedAvailability.lastNumber;

  const [newAppointment] = await db
    .insert(appointment)
    .values({
      doctorId: availability.doctorId,
      patientId,
      organizationId: availability.organizationId!,
      availabilityId: availability.id,
      bookingNumber,
      bookingDate: availability.date,
      appointmentDate: new Date(body.appointmentDate),
      status: "waiting",
    })
    .returning();

  return c.json(
    {
      success: true,
      appointment: newAppointment,
      bookingNumber,
      message: `Your booking number is ${bookingNumber}`,
    },
    201,
  );
}

export async function getMyAppointments(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const patientId = session.userId as string;

  const appointments = await db
    .select()
    .from(appointment)
    .where(eq(appointment.patientId, patientId));

  return c.json({ success: true, appointments });
}

export async function getDoctorAppointments(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const userId = session.userId as string;
  const doctorId = c.req.param("doctorId");
  const date = c.req.param("date");

  if (!doctorId) {
    throw new HTTPException(400, { message: "Doctor ID is required" });
  }

  const doctorRows = await db
    .select()
    .from(doctor)
    .where(eq(doctor.id, doctorId))
    .limit(1);

  if (!doctorRows.length) {
    throw new HTTPException(404, { message: "Doctor not found" });
  }

  const isDoctor = doctorRows[0].userId === userId;
  const role = (session as any).activeOrganizationRole as string | undefined;
  const isOwner = role === "owner";

  if (!isDoctor && !isOwner) {
    throw new HTTPException(403, {
      message: "Only the clinic owner or the doctor can view all appointments",
    });
  }

  const appointments = await db
    .select()
    .from(appointment)
    .where(
      and(
        eq(appointment.doctorId, doctorId),
        eq(appointment.bookingDate, date),
      ),
    );

  return c.json({ success: true, appointments });
}

export async function getAppointment(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const userId = session.userId as string;
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(appointment)
    .where(eq(appointment.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Appointment not found" });
  }

  const appt = rows[0];

  if (appt.patientId === userId) {
    return c.json({ success: true, appointment: appt });
  }

  const doctorRows = await db
    .select()
    .from(doctor)
    .where(and(eq(doctor.id, appt.doctorId), eq(doctor.userId, userId)))
    .limit(1);

  const role = (session as any).activeOrganizationRole as string | undefined;
  const isOwner = role === "owner";

  if (!doctorRows.length && !isOwner) {
    throw new HTTPException(403, {
      message: "You do not have access to this appointment",
    });
  }

  return c.json({ success: true, appointment: appt });
}

export async function updateAppointmentStatus(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const userId = session.userId as string;
  const id = c.req.param("id");
  const { status } = c.req.valid("json" as never) as any;

  const rows = await db
    .select()
    .from(appointment)
    .where(eq(appointment.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Appointment not found" });
  }

  const appt = rows[0];
  const isPatient = appt.patientId === userId;

  if (isPatient && status !== "cancelled") {
    throw new HTTPException(403, {
      message: "Patients can only cancel their own appointments",
    });
  }

  if (!isPatient) {
    const doctorRows = await db
      .select()
      .from(doctor)
      .where(and(eq(doctor.id, appt.doctorId), eq(doctor.userId, userId)))
      .limit(1);

    const role = (session as any).activeOrganizationRole as string | undefined;
    const isOwner = role === "owner";

    if (!doctorRows.length && !isOwner) {
      throw new HTTPException(403, {
        message:
          "Only the doctor or clinic owner can change appointment status",
      });
    }
  }

  const [updated] = await db
    .update(appointment)
    .set({ status })
    .where(eq(appointment.id, id))
    .returning();

  return c.json({ success: true, appointment: updated });
}

export async function deleteAppointment(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const session = c.get("session");
  const userId = session.userId as string;
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(appointment)
    .where(eq(appointment.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Appointment not found" });
  }

  const appt = rows[0];
  const isPatient = appt.patientId === userId;
  const role = (session as any).activeOrganizationRole as string | undefined;
  const isOwner = role === "owner";

  if (!isPatient && !isOwner) {
    throw new HTTPException(403, {
      message: "Only the patient or clinic owner can delete an appointment",
    });
  }

  await db.delete(appointment).where(eq(appointment.id, id));

  return c.json({ success: true, message: "Appointment deleted" });
}
