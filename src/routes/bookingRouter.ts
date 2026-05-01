import { Context, Hono } from "hono";
import { createDb } from "../db";
import {
  appointment,
  appointmentStatusEnum,
  doctor,
  doctorClinic,
} from "../db/schema/org-schema";
import { eq, and, sql } from "drizzle-orm";
import { requireOrgRole } from "../middleware/requireOrgRole";
import { verifyBetterAuthJWT } from "../middleware/authMiddleware";
import {
  check,
  integer,
  maxValue,
  minValue,
  number,
  object,
  picklist,
  pipe,
  string,
  transform,
  uuid,
} from "valibot";
import { sValidator } from "@hono/standard-validator";
import { requireSession } from "../middleware/sessionMiddleware";
import { member } from "../db/schema/auth-schema";

export const bookingRouter = new Hono();

// ─── Helper: get DO stub for a doctor+date pair ───────────────────────────────

function getQueueStub(c: Context, doctorId: string, bookingDate: string) {
  const ns = c.env.QUEUE_DO as DurableObjectNamespace; // bound in wrangler.toml
  const id = ns.idFromName(`${doctorId}:${bookingDate}`);
  return ns.get(id);
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createBookingSchema = object({
  doctorId: pipe(string(), uuid("Invalid UUID")),
  appointmentDate: pipe(
    string(),
    transform((input) => new Date(input)),
    check((d) => d > new Date(), "Appointment date must be in the future"),
  ),
  numberOfPatients: pipe(number(), integer(), minValue(1), maxValue(10)),
});

const updateStatusSchema = object({
  status: picklist(appointmentStatusEnum.enumValues),
});

// ─── Book an appointment ──────────────────────────────────────────────────────

bookingRouter.post(
  "/",
  verifyBetterAuthJWT,
  sValidator("json", createBookingSchema),
  async (c: Context) => {
    const db = createDb(c.env);
    const patientId = c.get("userId");
    const { doctorId, appointmentDate, numberOfPatients } = c.req.valid("json");
    const bookingDate = appointmentDate.toISOString().slice(0, 10);

    const [doc] = await db
      .select({ id: doctor.id })
      .from(doctor)
      .where(eq(doctor.id, doctorId))
      .limit(1);

    if (!doc) return c.json({ error: "Doctor not found" }, 404);

    const newAppointment = await db.transaction(async (tx) => {
      // Atomically increment lastNumber, insert if first booking of the day
      await tx
        .insert(doctorClinic)
        .values({ doctorId, bookingDate, lastNumber: 1, currentNumber: 0 })
        .onConflictDoUpdate({
          target: [doctorClinic.doctorId, doctorClinic.bookingDate],
          set: { lastNumber: sql`${doctorClinic.lastNumber} + 1` },
        });

      const [counter] = await tx
        .select({
          lastNumber: doctorClinic.lastNumber,
          currentNumber: doctorClinic.currentNumber,
        })
        .from(doctorClinic)
        .where(
          and(
            eq(doctorClinic.doctorId, doctorId),
            eq(doctorClinic.bookingDate, bookingDate),
          ),
        );

      const [appt] = await tx
        .insert(appointment)
        .values({
          doctorId,
          patientId,
          bookingNumber: counter.lastNumber,
          bookingDate,
          appointmentDate,
          numberOfPatients,
          status: "waiting",
        })
        .returning();

      return appt;
    });

    return c.json(
      {
        ...newAppointment,
        message: `Your token number is ${newAppointment.bookingNumber}`,
      },
      201,
    );
  },
);

// ─── WebSocket: live queue for a doctor+date ──────────────────────────────────
// GET /bookings/queue/:doctorId?date=YYYY-MM-DD
// Patients connect here to watch currentNumber in real time.

bookingRouter.get(
  "/queue/:doctorId",
  verifyBetterAuthJWT,
  async (c: Context) => {
    const doctorId = c.req.param("doctorId");
    const bookingDate =
      c.req.query("date") ?? new Date().toISOString().slice(0, 10);

    const stub = getQueueStub(c, doctorId, bookingDate);

    // Forward the WebSocket upgrade to the Durable Object
    return stub.fetch(
      new Request(`https://do/ws?tag=all`, {
        headers: c.req.raw.headers, // preserves the Upgrade header
      }),
    );
  },
);

// ─── Advance current patient number (owner only) ──────────────────────────────
// POST /bookings/doctor/:doctorId/advance?date=YYYY-MM-DD
// Receptionist presses "Next patient" — increments currentNumber and broadcasts.

bookingRouter.post(
  "/doctor/:doctorId/advance",
  requireOrgRole("owner"),
  async (c: Context) => {
    const db = createDb(c.env);
    const doctorId = c.req.param("doctorId");
    const bookingDate =
      c.req.query("date") ?? new Date().toISOString().slice(0, 10);

    // Atomically increment currentNumber (never beyond lastNumber)
    const [updated] = await db
      .update(doctorClinic)
      .set({
        currentNumber: sql`LEAST(${doctorClinic.currentNumber} + 1, ${doctorClinic.lastNumber})`,
      })
      .where(
        and(
          eq(doctorClinic.doctorId, doctorId),
          eq(doctorClinic.bookingDate, bookingDate),
        ),
      )
      .returning({
        currentNumber: doctorClinic.currentNumber,
        lastNumber: doctorClinic.lastNumber,
      });

    if (!updated)
      return c.json({ error: "No clinic session found for that date" }, 404);

    // Push to all connected WebSocket clients via the DO
    const stub = getQueueStub(c, doctorId, bookingDate);
    await stub.advanceCurrent(updated.currentNumber, updated.lastNumber);

    return c.json({
      currentNumber: updated.currentNumber,
      lastNumber: updated.lastNumber,
      message: `Now serving patient #${updated.currentNumber}`,
    });
  },
);

// ─── Get my bookings ──────────────────────────────────────────────────────────

bookingRouter.get("/me", verifyBetterAuthJWT, async (c: Context) => {
  const db = createDb(c.env);
  const patientId = c.get("userId");

  const bookings = await db
    .select({
      id: appointment.id,
      bookingNumber: appointment.bookingNumber,
      bookingDate: appointment.bookingDate,
      appointmentDate: appointment.appointmentDate,
      status: appointment.status,
      numberOfPatients: appointment.numberOfPatients,
      doctor: {
        id: doctor.id,
        name: doctor.name,
        image: doctor.image,
        slotDurationMins: doctor.slotDurationMins,
      },
    })
    .from(appointment)
    .innerJoin(doctor, eq(appointment.doctorId, doctor.id))
    .where(eq(appointment.patientId, patientId))
    .orderBy(appointment.appointmentDate);

  return c.json(bookings);
});

// ─── Get all bookings for a doctor on a date (owner only) ─────────────────────

bookingRouter.get(
  "/doctor/:doctorId",
  requireOrgRole("owner"),
  async (c: Context) => {
    const db = createDb(c.env);
    const doctorId = c.req.param("doctorId");
    const bookingDate =
      c.req.query("date") ?? new Date().toISOString().slice(0, 10);

    const bookings = await db
      .select()
      .from(appointment)
      .where(
        and(
          eq(appointment.doctorId, doctorId),
          eq(appointment.bookingDate, bookingDate),
        ),
      )
      .orderBy(appointment.bookingNumber);

    return c.json(bookings);
  },
);

// ─── Get a single booking ─────────────────────────────────────────────────────

bookingRouter.get(
  "/:bookingId",
  verifyBetterAuthJWT,
  requireSession,
  async (c: Context) => {
    const db = createDb(c.env);
    const bookingId = c.req.param("bookingId");
    const user = c.get("sessionUser");

    const [booking] = await db
      .select({
        id: appointment.id,
        bookingNumber: appointment.bookingNumber,
        bookingDate: appointment.bookingDate,
        appointmentDate: appointment.appointmentDate,
        status: appointment.status,
        numberOfPatients: appointment.numberOfPatients,
        patientId: appointment.patientId,
        ownerId: member.userId,
        doctor: {
          id: doctor.id,
          name: doctor.name,
          slotDurationMins: doctor.slotDurationMins,
        },
      })
      .from(appointment)
      .innerJoin(doctor, eq(appointment.doctorId, doctor.id))
      .where(eq(appointment.id, bookingId));

    if (!booking) return c.json({ error: "Not found" }, 404);

    // Enforce ownership: patients see only their own; owners see all
    if (booking.patientId !== user.id && user.id !== booking.ownerId) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return c.json(booking);
  },
);

// ─── Update booking status (owner only) ──────────────────────────────────────

bookingRouter.patch(
  "/:bookingId/status",
  requireOrgRole("owner"),
  sValidator("json", updateStatusSchema),
  async (c: Context) => {
    const db = createDb(c.env);
    const bookingId = c.req.param("bookingId");
    const { status } = c.req.valid("json");

    const [updated] = await db
      .update(appointment)
      .set({ status, updatedAt: new Date() })
      .where(eq(appointment.id, bookingId))
      .returning();

    if (!updated) return c.json({ error: "Not found" }, 404);

    return c.json(updated);
  },
);

// ─── Cancel a booking ─────────────────────────────────────────────────────────

bookingRouter.delete("/:bookingId", verifyBetterAuthJWT, async (c: Context) => {
  const db = createDb(c.env);
  const bookingId = c.req.param("bookingId");
  const userId = c.get("userId");

  const [existing] = await db
    .select({ patientId: appointment.patientId, status: appointment.status })
    .from(appointment)
    .where(eq(appointment.id, bookingId));

  if (!existing) return c.json({ error: "Not found" }, 404);

  if (existing.patientId !== userId && c.get("sessionUser").role !== "owner") {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (existing.status === "completed" || existing.status === "in_progress") {
    return c.json(
      { error: `Cannot cancel a booking that is ${existing.status}` },
      409,
    );
  }

  const [cancelled] = await db
    .update(appointment)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(appointment.id, bookingId))
    .returning();

  return c.json(cancelled);
});

export default bookingRouter;
