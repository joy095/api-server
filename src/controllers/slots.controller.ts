import { Context } from "hono";
import { z } from "zod";
import {
  getSlotsForDate,
  getNextAvailableDate,
} from "../services/availability.service";
import { ok, AppError } from "../lib/response";

const slotsQuerySchema = z.object({
  clinicId: z.string().uuid(),
  date: z.string().date(),
  slotDuration: z.coerce.number().int().min(5).max(120).default(15),
});

const nextAvailableQuerySchema = z.object({
  clinicId: z.string().uuid(),
  from: z.string().date().optional(),
  maxDays: z.coerce.number().int().min(1).max(90).default(30),
});

export const slotsController = {
  // GET /doctors/:id/slots?clinicId=&date=&slotDuration=
  getSlots: async (c: Context) => {
    const query = slotsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!query.success) {
      throw new AppError(
        "Invalid query: " + JSON.stringify(query.error.flatten().fieldErrors),
        422,
      );
    }

    const { clinicId, date, slotDuration } = query.data;
    const slots = await getSlotsForDate(
      c.req.param("id"),
      clinicId,
      date,
      slotDuration,
    );

    return ok(c, { date, slots });
  },

  // GET /doctors/:id/slots/next?clinicId=&from=&maxDays=
  getNextAvailable: async (c: Context) => {
    const query = nextAvailableQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!query.success) {
      throw new AppError("Invalid query", 422);
    }

    const { clinicId, from, maxDays } = query.data;
    const fromDate = from ?? new Date().toISOString().split("T")[0];

    const date = await getNextAvailableDate(
      c.req.param("id"),
      clinicId,
      fromDate,
      maxDays,
    );

    return ok(c, { nextAvailableDate: date ?? null });
  },
};
