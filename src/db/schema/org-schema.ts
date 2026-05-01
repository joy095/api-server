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
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "waiting",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);

// ─── Doctor ───────────────────────────────────────────────────────────────────

export const doctor = pgTable(
  "doctor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    image: text("image"),
    description: text("description").notNull(),
    certificateId: uuid("certificate_id").array().notNull(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => doctorExperience.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    specialized: varchar({ length: 50 }),
    slotDurationMins: integer("slot_duration_mins").notNull().default(15),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("doctor_name_idx").on(t.name)],
);

// ─── Doctor Clinic Counter ────────────────────────────────────────────────────
// One row per doctor per day.
// lastNumber   = highest booking number issued (monotonically incremented)
// currentNumber = the booking number the doctor is currently serving
//                 (drives the real-time queue display)

export const doctorClinic = pgTable(
  "doctor_clinic",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    bookingDate: date("booking_date").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
    // ← NEW: which token the doctor is currently serving
    currentNumber: integer("current_number").notNull().default(0),
  },
  (t) => [
    unique("doctor_clinic_doctor_date_uniq").on(t.doctorId, t.bookingDate),
    index("doctor_clinic_date_idx").on(t.bookingDate),
  ],
);

export const doctorExperience = pgTable("doctor_experience", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization: varchar({ length: 255 }).notNull(),
  description: text(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
});

export const certificate = pgTable("certificate", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).notNull(),
  description: text(),
  issuedAt: date("issued_at").notNull(),
  expiresAt: date("expires_at"),
});

// ─── Appointment ──────────────────────────────────────────────────────────────

export const appointment = pgTable(
  "appointment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    numberOfPatients: integer("no_of_patient").notNull(),
    bookingNumber: integer("booking_number").notNull(),
    bookingDate: date("booking_date").notNull(),
    status: appointmentStatusEnum("status").notNull().default("waiting"),
    appointmentDate: timestamp("appointment_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    unique("appointment_doctor_date_number_uniq").on(
      t.doctorId,
      t.bookingDate,
      t.bookingNumber,
    ),
    index("appointment_doctor_date_idx").on(t.doctorId, t.bookingDate),
    index("appointment_status_idx").on(t.status),
  ],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const doctorRelations = relations(doctor, ({ many }) => ({
  appointments: many(appointment),
  clinicCounters: many(doctorClinic),
  experiences: many(doctorExperience),
  certificates: many(certificate),
}));

export const appointmentRelations = relations(appointment, ({ one }) => ({
  doctor: one(doctor, {
    fields: [appointment.doctorId],
    references: [doctor.id],
  }),
  patient: one(user, {
    fields: [appointment.patientId],
    references: [user.id],
  }),
}));

export const doctorClinicRelations = relations(doctorClinic, ({ one }) => ({
  doctor: one(doctor, {
    fields: [doctorClinic.doctorId],
    references: [doctor.id],
  }),
}));
