import { DurableObject } from "cloudflare:workers";

// ─── Message shapes ───────────────────────────────────────────────────────────

export interface QueueState {
  currentNumber: number;
  lastNumber: number;
}

export type ServerMessage =
  | { type: "queue_state"; data: QueueState } // full snapshot on connect
  | { type: "current_updated"; currentNumber: number }; // incremental push

// ─── Durable Object ───────────────────────────────────────────────────────────
// One DO instance per "doctorId:bookingDate" key.
// Hibernation keeps memory cost near-zero between messages.

export class QueueDO extends DurableObject {
  // ── WebSocket upgrade ──────────────────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();

    // Tags let us filter sockets later if needed (e.g. per-patient rooms)
    const tag = url.searchParams.get("tag") ?? "all";
    this.ctx.acceptWebSocket(server, [tag]);

    // Send the current snapshot immediately so the UI has something to render
    const state = await this.getState();
    server.send(
      JSON.stringify({
        type: "queue_state",
        data: state,
      } satisfies ServerMessage),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Called by the HTTP route when the doctor advances the queue ────────────
  async advanceCurrent(
    currentNumber: number,
    lastNumber: number,
  ): Promise<void> {
    // Persist so reconnecting clients get the latest value
    await this.ctx.storage.put<QueueState>("state", {
      currentNumber,
      lastNumber,
    });

    // Broadcast to every hibernated socket tagged "all"
    const msg: ServerMessage = { type: "current_updated", currentNumber };
    const payload = JSON.stringify(msg);

    for (const ws of this.ctx.getWebSockets("all")) {
      ws.send(payload);
    }
  }

  // ── Hibernation handler — called when a socket sends data ──────────────────
  // Patients never need to send anything, but handle it gracefully.
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    // No-op: this DO is broadcast-only from the server side.
    // Extend here if you ever need client→server messages (e.g. ping/pong).
  }

  // ── Hibernation handler — cleanup on disconnect ────────────────────────────
  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async getState(): Promise<QueueState> {
    return (
      (await this.ctx.storage.put<QueueState>("state", undefined as any), // no-op write to satisfy TS
      await this.ctx.storage.get<QueueState>("state")) ?? {
        currentNumber: 0,
        lastNumber: 0,
      }
    );
  }
}
