import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  index,
  uuid,
  varchar,
  text,
  timestamp,
  smallint,
  real,
  boolean,
  date,
  pgEnum,
  unique,
  time,
  jsonb,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const recurrentTypeEnum = pgEnum("recurrence_type", [
  "daily",
  "weekly",
  "monthly",
]);

// Fixed: enum name should describe the enum, not a status value
export const patientStatusEnum = pgEnum("patient_status", [
  "new",
  "follow_up", // fixed: hyphens not allowed in PG enum values reliably
  "emergency",
]);

// Fixed: enum name was "status" — renamed to be descriptive
export const bookViaEnum = pgEnum("book_via", ["web", "app", "walk_in"]);

export const userRoleEnum = pgEnum("user_role", ["admin", "doctor", "staff"]);

// ─────────────────────────────────────────────
// CLINIC
// ─────────────────────────────────────────────

export const clinic = pgTable("clinic", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  address: text("address"),
  // Store as integer microdegrees (±180° × 1e6 fits in int4) — no float precision issues
  // OR keep real() if you prefer simplicity. Shown here as real for readability.
  phone: varchar("phone", { length: 20 }),
  latitude: real("latitude"),
  longitude: real("longitude"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ─────────────────────────────────────────────
// DOCTOR
// ─────────────────────────────────────────────

export const doctor = pgTable("doctor", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  image: text("image"),
  // Use a short code/slug instead of free text for better filtering
  specialist: varchar("specialist", { length: 100 }).notNull(),
  description: text("description").notNull(),
  yearsOfExp: smallint("years_of_exp"), // max 32k — more than enough, saves 2 bytes vs int
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Junction table: which clinics a doctor works at
export const doctorClinic = pgTable(
  "doctor_clinic",
  {
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinic.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("doctor_clinic_unique").on(t.doctorId, t.clinicId),
    index("doctor_clinic_clinic_idx").on(t.clinicId),
  ],
);

// ─────────────────────────────────────────────
// AVAILABILITY RULES
// ─────────────────────────────────────────────

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id") // Fixed: was text — should be uuid to match doctor.id
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinic.id, { onDelete: "cascade" }),
    recurrentType: recurrentTypeEnum("recurrent_type")
      .default("weekly")
      .notNull(),
    // day_of_week: 0=Sun … 6=Sat (used when recurrentType = 'weekly')
    dayOfWeek: smallint("day_of_week"),
    // day_of_month: 1–31 (used when recurrentType = 'monthly')
    dayOfMonth: smallint("day_of_month"),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    // jsonb is compressed + indexable; array of {start: minutes, end: minutes}
    breaks: jsonb("breaks").default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("avail_doctor_idx").on(t.doctorId),
    index("avail_clinic_idx").on(t.clinicId),
    index("avail_doctor_clinic_idx").on(t.doctorId, t.clinicId),
  ],
);

// ─────────────────────────────────────────────
// PATIENTS
// ─────────────────────────────────────────────

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    dob: date("dob"),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("patients_phone_idx").on(t.phone),
    index("patients_email_idx").on(t.email),
  ],
);

// ─────────────────────────────────────────────
// APPOINTMENT TYPES
// ─────────────────────────────────────────────

export const appointmentTypes = pgTable(
  "appointment_type",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    // A type definition shouldn't store patientId — that belongs on the booking
    name: varchar("name", { length: 100 }).notNull(),
    status: patientStatusEnum("status").default("new").notNull(),
    // Duration in minutes helps with scheduling
    durationMinutes: smallint("duration_minutes").default(15).notNull(),
  },
  (t) => [index("appt_type_doctor_idx").on(t.doctorId)],
);

// ─────────────────────────────────────────────
// BOOKING
// ─────────────────────────────────────────────

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

export const booking = pgTable(
  "booking",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id") // Fixed: was doctorID (inconsistent casing)
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinic.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    appointmentTypeId: uuid("appointment_type_id").references(
      () => appointmentTypes.id,
    ),
    bookingStatus: bookingStatusEnum("booking_status")
      .default("pending")
      .notNull(),
    bookVia: bookViaEnum("book_via").default("walk_in").notNull(),
    // Serial number per doctor per day (for queue management)
    dailySerial: smallint("daily_serial").notNull(),
    serialDate: date("serial_date").notNull(),
    scheduledAt: timestamp("scheduled_at"), // actual appointment datetime
    cancelNote: text("cancel_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // Core queue uniqueness: one serial number per doctor per day
    unique("unique_serial").on(t.doctorId, t.dailySerial, t.serialDate),
    index("booking_doctor_date_idx").on(t.doctorId, t.serialDate),
    index("booking_patient_idx").on(t.patientId),
    index("booking_clinic_idx").on(t.clinicId),
    index("booking_status_idx").on(t.bookingStatus),
  ],
);

// ─────────────────────────────────────────────
// RELATIONS
// ─────────────────────────────────────────────

export const doctorRelations = relations(doctor, ({ many }) => ({
  availabilityRules: many(availabilityRules),
  appointmentTypes: many(appointmentTypes),
  bookings: many(booking),
  clinics: many(doctorClinic),
}));

export const clinicRelations = relations(clinic, ({ many }) => ({
  bookings: many(booking),
  availabilityRules: many(availabilityRules),
  doctors: many(doctorClinic),
}));

export const doctorClinicRelations = relations(doctorClinic, ({ one }) => ({
  doctor: one(doctor, {
    fields: [doctorClinic.doctorId],
    references: [doctor.id],
  }),
  clinic: one(clinic, {
    fields: [doctorClinic.clinicId],
    references: [clinic.id],
  }),
}));

export const availabilityRulesRelations = relations(
  availabilityRules,
  ({ one }) => ({
    doctor: one(doctor, {
      fields: [availabilityRules.doctorId],
      references: [doctor.id],
    }),
    clinic: one(clinic, {
      fields: [availabilityRules.clinicId],
      references: [clinic.id],
    }),
  }),
);

export const patientsRelations = relations(patients, ({ many }) => ({
  bookings: many(booking),
}));

export const appointmentTypesRelations = relations(
  appointmentTypes,
  ({ one, many }) => ({
    doctor: one(doctor, {
      fields: [appointmentTypes.doctorId],
      references: [doctor.id],
    }),
    bookings: many(booking),
  }),
);

export const bookingRelations = relations(booking, ({ one }) => ({
  doctor: one(doctor, {
    fields: [booking.doctorId],
    references: [doctor.id],
  }),
  clinic: one(clinic, {
    fields: [booking.clinicId],
    references: [clinic.id],
  }),
  patient: one(patients, {
    fields: [booking.patientId],
    references: [patients.id],
  }),
  appointmentType: one(appointmentTypes, {
    fields: [booking.appointmentTypeId],
    references: [appointmentTypes.id],
  }),
}));
