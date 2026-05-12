import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  index,
  integer,
  date,
  unique,
  uuid,
  varchar,
  decimal,
  boolean,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";
import { doctor } from "./doctor-schema";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "waiting",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);

export const daySegmentEnum = pgEnum("day_segment", [
  "morning",
  "afternoon",
  "evening",
  "night",
]);

export const daysOfWeekEnum = pgEnum("day_of_week", [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

export const availabilityPatternEnum = pgEnum("availability_pattern", [
  "daily", // Applies every day
  "weekly", // Applies on specific days of week (mon, tue, ...)
  "monthly", // Applies on specific day-of-month (1–31)
]);

// ─── Location ─────────────────────────────────────────────────────────────────

export const location = pgTable("location", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").references(() => organization.id, {
    onDelete: "cascade",
  }),
  address: text("address").notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 50 }).notNull(),
  lat: decimal("lat", { precision: 9, scale: 6 }),
  lng: decimal("lng", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ─── Doctor Availability Template ─────────────────────────────────────────────
// Replaces doctorWeeklySchedule. Defines recurring availability patterns.
//
// Pattern rules (enforce in app logic):
//   daily   → dayOfWeek = null, dayOfMonth = null
//   weekly  → dayOfWeek = "mon"|"tue"|..., dayOfMonth = null
//   monthly → dayOfWeek = null, dayOfMonth = 1–31

export const doctorAvailabilityTemplate = pgTable(
  "doctor_availability_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    pattern: availabilityPatternEnum("pattern").notNull(),
    dayOfWeek: daysOfWeekEnum("day_of_week"),
    dayOfMonth: integer("day_of_month"),

    // Added Segment and Specific Times
    segment: daySegmentEnum("segment").notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(), // e.g., "08:00"
    endTime: varchar("end_time", { length: 5 }), // e.g., "10:00"

    maxCapacity: integer("max_capacity"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // Updated unique constraint: A doctor can now have multiple shifts in the same segment
    // as long as the start times are different.
    unique("template_uniq").on(
      t.doctorId,
      t.pattern,
      t.dayOfWeek,
      t.dayOfMonth,
      t.segment,
      t.startTime,
    ),
  ],
);

// ─── Doctor Availability (The Resolved Daily Instance) ─────────────────────────
// Created when: 1. A booking occurs for a template day OR 2. Manual override.
// References the template that generated it (nullable for manual overrides).

export const doctorAvailability = pgTable(
  "doctor_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    templateId: uuid("template_id").references(
      () => doctorAvailabilityTemplate.id,
      { onDelete: "set null" },
    ),

    date: date("date").notNull(),
    segment: daySegmentEnum("segment").notNull(),

    // Carry over times for the specific instance
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }),

    lastNumber: integer("last_number").notNull().default(0),
    currentNumber: integer("current_number").notNull().default(0),
    isCancelled: boolean("is_cancelled").default(false),

    maxCapacity: integer("max_capacity"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // Unique constraint now includes startTime to allow multiple shifts per day/segment
    unique("doctor_avail_date_shift_uniq").on(t.doctorId, t.date, t.startTime),
    index("avail_doctor_date_idx").on(t.doctorId, t.date),
  ],
);

// ─── Appointment ──────────────────────────────────────────────────────────────

export const appointment = pgTable(
  "appointment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "restrict" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    availabilityId: uuid("availability_id")
      .notNull()
      .references(() => doctorAvailability.id, { onDelete: "restrict" }),
    bookingNumber: integer("booking_number").notNull(),
    bookingDate: date("booking_date").notNull(),
    appointmentDate: timestamp("appointment_date").notNull(),
    status: appointmentStatusEnum("status").notNull().default("waiting"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    unique("appointment_doctor_date_number_uniq").on(
      t.doctorId,
      t.bookingDate,
      t.bookingNumber,
    ),
    index("appointment_patient_idx").on(t.patientId),
    index("appointment_doctor_date_idx").on(t.doctorId, t.bookingDate),
    index("appointment_status_idx").on(t.status),
  ],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const locationRelations = relations(location, ({ one, many }) => ({
  organization: one(organization, {
    fields: [location.organizationId],
    references: [organization.id],
  }),
  doctors: many(doctor),
}));

export const doctorAvailabilityTemplateRelations = relations(
  doctorAvailabilityTemplate,
  ({ one, many }) => ({
    doctor: one(doctor, {
      fields: [doctorAvailabilityTemplate.doctorId],
      references: [doctor.id],
    }),
    organization: one(organization, {
      fields: [doctorAvailabilityTemplate.organizationId],
      references: [organization.id],
    }),
    availabilities: many(doctorAvailability),
  }),
);

export const doctorAvailabilityRelations = relations(
  doctorAvailability,
  ({ one, many }) => ({
    doctor: one(doctor, {
      fields: [doctorAvailability.doctorId],
      references: [doctor.id],
    }),
    template: one(doctorAvailabilityTemplate, {
      fields: [doctorAvailability.templateId],
      references: [doctorAvailabilityTemplate.id],
    }),
    appointments: many(appointment),
  }),
);

export const appointmentRelations = relations(appointment, ({ one }) => ({
  doctor: one(doctor, {
    fields: [appointment.doctorId],
    references: [doctor.id],
  }),
  patient: one(user, {
    fields: [appointment.patientId],
    references: [user.id],
  }),
  availability: one(doctorAvailability, {
    fields: [appointment.availabilityId],
    references: [doctorAvailability.id],
  }),
}));
