import { z } from "zod";

// ─── Common Schemas ───────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Doctor Schemas ───────────────────────────────────────────────────────────

export const createDoctorSchema = z.object({
  name: z.string().min(1).max(100),
  image: z.string().url().optional(),
  specialist: z.string().min(1).max(100),
  description: z.string().min(1),
  yearsOfExp: z.number().int().min(0).max(100).optional(),
});

export const updateDoctorSchema = createDoctorSchema.partial();

export const assignDoctorClinicSchema = z.object({
  clinicId: z.string().uuid(),
});

// ─── Clinic Schemas ───────────────────────────────────────────────────────────

export const createClinicSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().optional(),
  phone: z.string().max(20).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const updateClinicSchema = createClinicSchema.partial();

export const addClinicMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["doctor", "staff", "admin"]).default("staff"),
});

// ─── Patient Schemas ──────────────────────────────────────────────────────────

export const createPatientSchema = z.object({
  name: z.string().min(1).max(100),
  dob: z.string().date().optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
});

export const updatePatientSchema = createPatientSchema.partial();

// ─── Availability Rule Schemas ────────────────────────────────────────────────

export const createAvailabilityRuleSchema = z.object({
  clinicId: z.string().uuid(),
  recurrentType: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breaks: z
    .array(
      z.object({
        start: z.number().int().min(0).max(1440),
        end: z.number().int().min(0).max(1440),
      }),
    )
    .default([]),
  isActive: z.boolean().default(true),
});

export const updateAvailabilityRuleSchema =
  createAvailabilityRuleSchema.partial();

// ─── Appointment Type Schemas ─────────────────────────────────────────────────

export const createAppointmentTypeSchema = z.object({
  name: z.string().min(1).max(100),
  status: z.enum(["new", "follow_up", "emergency"]).default("new"),
  durationMinutes: z.number().int().min(5).max(480).default(15),
});

export const updateAppointmentTypeSchema =
  createAppointmentTypeSchema.partial();

// ─── Booking Schemas ──────────────────────────────────────────────────────────

export const createBookingSchema = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  appointmentTypeId: z.string().uuid().optional(),
  bookVia: z.enum(["web", "app", "walk_in"]).default("walk_in"),
  serialDate: z.string().date(),
  scheduledAt: z.string().datetime().optional(),
});

export const updateBookingSchema = z.object({
  bookingStatus: z
    .enum(["pending", "confirmed", "cancelled", "completed", "no_show"])
    .optional(),
  cancelNote: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});

export const bookingQuerySchema = paginationSchema.extend({
  doctorId: z.string().uuid().optional(),
  clinicId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: z
    .enum(["pending", "confirmed", "cancelled", "completed", "no_show"])
    .optional(),
  date: z.string().date().optional(),
});
