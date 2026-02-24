import { Hono } from "hono";
import { createSseStream } from "../sse/queue.sse";
import { requireAuth } from "../middlewares";
import { AppError } from "../lib/response";
import type { AuthUser } from "../types";

export const sseRoutes = new Hono();

/**
 * GET /sse/queue/:doctorId
 *
 * Subscribe to live booking queue updates for a specific doctor on a given date.
 *
 * Query params:
 *   date  — ISO date string "YYYY-MM-DD" (defaults to today)
 *
 * The stream sends SSE events:
 *   - `connected`        — emitted immediately on subscribe
 *   - `booking_created`  — a new booking was added to the queue
 *   - `booking_updated`  — a booking status changed (e.g. confirmed, completed)
 *   - `booking_cancelled`— a booking was cancelled or deleted
 *   - `ping`             — heartbeat every ~25 s (keep connections alive through proxies)
 *
 * Usage (browser):
 *   const es = new EventSource('/api/v1/sse/queue/DOCTOR_UUID?date=2025-06-01', {
 *     headers: { Authorization: 'Bearer <token>' }  // use EventSource polyfill for headers
 *   });
 *   es.addEventListener('booking_updated', e => console.log(JSON.parse(e.data)));
 *
 * Patients: the server will filter events — they only receive updates for their own booking.
 *           Pass patientId query param or derive it from the auth session.
 *
 * Staff/Admins: receive all events for the doctor+date.
 */
sseRoutes.get("/queue/:doctorId", requireAuth, (c) => {
  const doctorId = c.req.param("doctorId");
  const date =
    c.req.query("date") ?? new Date().toISOString().split("T")[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError("Invalid date format — use YYYY-MM-DD", 400);
  }

  const user: AuthUser = c.get("user");

  // For patients (role "member" or no org role), filter events to their own bookings
  // In a real app you'd look up the patient record linked to this user
  const patientIdFilter =
    user.role === "staff" ||
    user.role === "doctor" ||
    user.role === "admin" ||
    user.role === "owner"
      ? undefined
      : user.id; // use user.id as a patient filter key

  const stream = createSseStream(doctorId, date, patientIdFilter);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering for SSE
    },
  });
});
