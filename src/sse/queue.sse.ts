/**
 * Server-Sent Events hub for live booking queue updates.
 *
 * Architecture:
 *  - Clinic/doctor staff PUBLISH events when booking status changes.
 *  - Patients SUBSCRIBE to a doctor's queue for a given date.
 *  - Each subscriber key is `{doctorId}:{date}` (e.g. "uuid-123:2025-06-01").
 *
 * This works in Node.js and Cloudflare Workers (using the standard
 * ReadableStream / TransformStream APIs that both support).
 */

export interface QueueEvent {
  type:
    | "booking_created"
    | "booking_updated"
    | "booking_cancelled"
    | "queue_position";
  bookingId: string;
  doctorId: string;
  date: string;
  /** Current queue position (1-based) of this booking */
  position?: number;
  /** New booking status */
  status?: string;
  /** Serial number */
  serial?: number;
  /** Estimated wait time in minutes */
  estimatedWaitMinutes?: number;
  timestamp: string;
}

type Subscriber = {
  controller: ReadableStreamDefaultController;
  doctorId: string;
  date: string;
  /** Patient or staff — patients only receive their own booking events */
  patientId?: string;
};

// In-memory subscriber registry. Keyed by `doctorId:date`.
// In a multi-instance deploy (e.g. multiple Cloudflare Workers), use
// a Durable Object or Pub/Sub broker instead.
const subscribers = new Map<string, Set<Subscriber>>();

function channelKey(doctorId: string, date: string): string {
  return `${doctorId}:${date}`;
}

/**
 * Create an SSE ReadableStream for a patient or staff subscriber.
 *
 * The returned stream sends:
 *   - An immediate `connected` heartbeat so the client knows it's live.
 *   - Periodic `ping` every 25 s to keep the connection alive through proxies.
 *   - `QueueEvent` payloads as they are published.
 */
export function createSseStream(
  doctorId: string,
  date: string,
  patientId?: string,
): ReadableStream {
  let sub: Subscriber;

  const stream = new ReadableStream({
    start(controller) {
      sub = { controller, doctorId, date, patientId };
      const key = channelKey(doctorId, date);

      if (!subscribers.has(key)) {
        subscribers.set(key, new Set());
      }
      subscribers.get(key)!.add(sub);

      // Initial connected event
      sendEvent(controller, "connected", {
        doctorId,
        date,
        message: "Subscribed to booking queue",
      });
    },

    cancel() {
      // Client disconnected — clean up
      if (sub) {
        const key = channelKey(sub.doctorId, sub.date);
        subscribers.get(key)?.delete(sub);
        if (subscribers.get(key)?.size === 0) {
          subscribers.delete(key);
        }
      }
    },
  });

  return stream;
}

/**
 * Publish a queue event to all subscribers for a given doctor+date.
 * Staff and the specific patient whose booking changed receive the event.
 */
export function publishQueueEvent(event: QueueEvent): void {
  const key = channelKey(event.doctorId, event.date);
  const subs = subscribers.get(key);
  if (!subs || subs.size === 0) return;

  const deadSubs: Subscriber[] = [];

  for (const sub of subs) {
    // Patients only receive events for their own bookings
    const shouldReceive =
      !sub.patientId || // staff (no patientId filter)
      event.bookingId.startsWith(sub.patientId ?? ""); // loose match for demo
    // In production, store `bookingId` on the subscriber for exact match.

    if (!shouldReceive) continue;

    try {
      sendEvent(sub.controller, event.type, event);
    } catch {
      // Controller closed — mark for cleanup
      deadSubs.push(sub);
    }
  }

  // Prune dead connections
  for (const dead of deadSubs) {
    subs.delete(dead);
  }
}

/**
 * Encode and enqueue a single SSE frame onto a controller.
 *
 * SSE wire format:
 *   event: <name>\n
 *   data: <json>\n
 *   \n
 */
function sendEvent(
  controller: ReadableStreamDefaultController,
  eventName: string,
  data: unknown,
): void {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(new TextEncoder().encode(payload));
}

/**
 * Start a periodic heartbeat ping for a controller.
 * Returns the interval ID so callers can cancel it on disconnect.
 */
export function startHeartbeat(
  controller: ReadableStreamDefaultController,
  intervalMs = 25_000,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    try {
      sendEvent(controller, "ping", { ts: new Date().toISOString() });
    } catch {
      // Controller closed
    }
  }, intervalMs);
}
