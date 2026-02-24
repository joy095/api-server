import { Context } from "hono";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  appointmentTypes,
  booking,
  clinic,
  doctor,
  patients,
} from "../db/schema/schema";
import { ok, created, noContent, paginated, AppError } from "../lib/response";
import {
  allocateSerial,
  assertWithinAvailability,
  assertValidTransition,
  getBookingOrThrow,
  type BookingStatus,
} from "../services/booking.service";
import {
  getDoctorOrThrow,
  assertDoctorInClinic,
} from "../services/doctor.service";
import type { z } from "zod";
import type {
  createBookingSchema,
  updateBookingSchema,
  bookingQuerySchema,
} from "../validators";
import { createDb } from "../db";
import { publishQueueEvent } from "../sse/queue.sse";

type CreateBooking = z.infer<typeof createBookingSchema>;
type UpdateBooking = z.infer<typeof updateBookingSchema>;
type BookingQuery = z.infer<typeof bookingQuerySchema>;

export const bookingController = {
  // GET /bookings
  list: async (c: Context) => {
    const query: BookingQuery = c.get("validatedQuery");
    const { page, limit, doctorId, clinicId, patientId, status, date } = query;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (doctorId) conditions.push(eq(booking.doctorId, doctorId));
    if (clinicId) conditions.push(eq(booking.clinicId, clinicId));
    if (patientId) conditions.push(eq(booking.patientId, patientId));
    if (status) conditions.push(eq(booking.bookingStatus, status));
    if (date) conditions.push(eq(booking.serialDate, date));

    const db = createDb(c.env);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select({ booking, doctor, clinic, patients, appointmentTypes })
        .from(booking)
        .leftJoin(doctor, eq(booking.doctorId, doctor.id))
        .leftJoin(clinic, eq(booking.clinicId, clinic.id))
        .leftJoin(patients, eq(booking.patientId, patients.id))
        .leftJoin(
          appointmentTypes,
          eq(booking.appointmentTypeId, appointmentTypes.id),
        )
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(booking.serialDate), booking.dailySerial)
        .limit(limit)
        .offset(offset),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(booking)
        .where(conditions.length ? and(...conditions) : undefined),
    ]);

    return paginated(c, rows, count, page, limit);
  },

  // GET /bookings/:id
  getById: async (c: Context) => {
    const db = createDb(c.env);

    const rows = await db
      .select({ booking, doctor, clinic, patients, appointmentTypes })
      .from(booking)
      .leftJoin(doctor, eq(booking.doctorId, doctor.id))
      .leftJoin(clinic, eq(booking.clinicId, clinic.id))
      .leftJoin(patients, eq(booking.patientId, patients.id))
      .leftJoin(
        appointmentTypes,
        eq(booking.appointmentTypeId, appointmentTypes.id),
      )
      .where(eq(booking.id, c.req.param("id")))
      .limit(1);

    const row = rows[0];
    if (!row) throw new AppError("Booking not found", 404);
    return ok(c, row);
  },

  // GET /doctors/:id/bookings
  listByDoctor: async (c: Context) => {
    const doctorId = c.req.param("id");
    const date = c.req.query("date") ?? new Date().toISOString().split("T")[0];
    const status = c.req.query("status");

    const conditions: ReturnType<typeof eq>[] = [
      eq(booking.doctorId, doctorId),
      eq(booking.serialDate, date),
    ];
    if (status)
      conditions.push(eq(booking.bookingStatus, status as BookingStatus));

    const db = createDb(c.env);

    const rows = await db
      .select({ booking, patients, appointmentTypes, clinic })
      .from(booking)
      .leftJoin(patients, eq(booking.patientId, patients.id))
      .leftJoin(
        appointmentTypes,
        eq(booking.appointmentTypeId, appointmentTypes.id),
      )
      .leftJoin(clinic, eq(booking.clinicId, clinic.id))
      .where(and(...conditions))
      .orderBy(booking.dailySerial);

    return ok(c, rows);
  },

  // POST /doctors/:id/bookings
  create: async (c: Context) => {
    const doctorId = c.req.param("id");
    const body: CreateBooking = c.get("validatedBody");

    // Validate doctor exists and is assigned to this clinic
    await getDoctorOrThrow(doctorId, c.env);
    await assertDoctorInClinic(doctorId, body.clinicId, c.env);

    // Validate the booking falls within an availability window
    const scheduledAt = body.scheduledAt
      ? new Date(body.scheduledAt)
      : undefined;
    await assertWithinAvailability(
      doctorId,
      body.clinicId,
      body.serialDate,
      scheduledAt,
      c.env,
    );

    const db = createDb(c.env);

    const newBooking = await db.transaction(async (tx) => {
      // allocateSerial correctly receives the transaction for FOR UPDATE locking
      const dailySerial = await allocateSerial(tx, doctorId, body.serialDate);
      const [row] = await tx
        .insert(booking)
        .values({ ...body, doctorId, dailySerial, scheduledAt })
        .returning();
      return row;
    });

    // Broadcast SSE event to all subscribers watching this doctor+date queue
    publishQueueEvent({
      type: "booking_created",
      bookingId: newBooking.id,
      doctorId,
      date: body.serialDate,
      serial: newBooking.dailySerial,
      status: newBooking.bookingStatus,
      timestamp: new Date().toISOString(),
    });

    return created(c, newBooking);
  },

  // PATCH /bookings/:id
  update: async (c: Context) => {
    const body: UpdateBooking = c.get("validatedBody");
    const id = c.req.param("id");

    // Enforce state machine transitions
    if (body.bookingStatus) {
      const current = await getBookingOrThrow(id, c.env);
      assertValidTransition(
        current.bookingStatus as BookingStatus,
        body.bookingStatus as BookingStatus,
      );
    }

    if (body.bookingStatus === "cancelled" && !body.cancelNote) {
      throw new AppError(
        "cancelNote is required when cancelling a booking",
        400,
        "CANCEL_NOTE_REQUIRED",
      );
    }

    const db = createDb(c.env);

    const [row] = await db
      .update(booking)
      .set({
        ...body,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(booking.id, id))
      .returning();

    if (!row) throw new AppError("Booking not found", 404);

    const eventType =
      row.bookingStatus === "cancelled" ? "booking_cancelled" : "booking_updated";

    publishQueueEvent({
      type: eventType,
      bookingId: row.id,
      doctorId: row.doctorId,
      date: row.serialDate,
      serial: row.dailySerial,
      status: row.bookingStatus,
      timestamp: new Date().toISOString(),
    });

    return ok(c, row);
  },

  // DELETE /bookings/:id
  delete: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .delete(booking)
      .where(eq(booking.id, c.req.param("id")))
      .returning({
        id: booking.id,
        doctorId: booking.doctorId,
        serialDate: booking.serialDate,
      });

    if (!row) throw new AppError("Booking not found", 404);

    publishQueueEvent({
      type: "booking_cancelled",
      bookingId: row.id,
      doctorId: row.doctorId,
      date: row.serialDate,
      timestamp: new Date().toISOString(),
    });

    return noContent(c);
  },

  // GET /doctors/:id/bookings/stats
  stats: async (c: Context) => {
    const doctorId = c.req.param("id");
    const from = c.req.query("from") ?? new Date().toISOString().split("T")[0];
    const to = c.req.query("to") ?? from;

    const db = createDb(c.env);

    const rows = await db.execute(sql`
      SELECT
        serial_date::text                                          AS date,
        COUNT(*)::int                                              AS total,
        COUNT(*) FILTER (WHERE booking_status = 'completed')::int  AS completed,
        COUNT(*) FILTER (WHERE booking_status = 'cancelled')::int  AS cancelled,
        COUNT(*) FILTER (WHERE booking_status = 'no_show')::int    AS no_show,
        COUNT(*) FILTER (
          WHERE booking_status IN ('pending','confirmed')
        )::int                                                     AS upcoming
      FROM booking
      WHERE doctor_id  = ${doctorId}
        AND serial_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY serial_date
      ORDER BY serial_date
    `);

    return ok(c, rows);
  },
};
