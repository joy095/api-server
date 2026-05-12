import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { isNull, relations } from "drizzle-orm";
import { appointment, doctorAvailability } from "./org-schema";

// ─── Doctor ───────────────────────────────────────────────────────────────────

export const doctor = pgTable(
  "doctor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    specialized: varchar("specialized", { length: 100 }),
    slotDurationMins: integer("slot_duration_mins"),
    isActive: boolean("is_active").default(true).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"), // Soft delete support
  },
  (table) => [
    uniqueIndex("doctor_slug_unique_active")
      .on(table.slug)
      .where(isNull(table.deletedAt)),
    index("doctor_specialized_idx").on(table.specialized),
    index("doctor_user_id_idx").on(table.userId),
    index("doctor_active_idx").on(table.isActive),
  ],
);

// ─── Professional History ─────────────────────────────────────────────────────

export const doctorExperience = pgTable(
  "doctor_experience",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    organization: varchar("organization", { length: 255 }).notNull(),
    image: text("image"),
    description: text("description"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
  },
  (table) => [index("experience_doctor_id_idx").on(table.doctorId)],
);

export const certificate = pgTable(
  "certificate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctor.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text(),
    image: text("image"),
    issuedAt: date("issued_at").notNull(),
    expiresAt: date("expires_at"),
  },
  (table) => [index("certificate_doctor_id_idx").on(table.doctorId)],
);

export const doctorEducation = pgTable("doctor_education", {
  id: uuid("id").primaryKey().defaultRandom(),
  doctorId: uuid("doctor_id")
    .notNull()
    .references(() => doctor.id, { onDelete: "cascade" }),
  degree: varchar("degree", { length: 100 }).notNull(), // e.g., MBBS, MD
  university: varchar("university", { length: 255 }).notNull(),
  graduationYear: integer("graduation_year"),
});

// ─── Certificate ──────────────────────────────────────────────────────────────

export const doctorRelations = relations(doctor, ({ many, one }) => ({
  appointments: many(appointment),
  experiences: many(doctorExperience),
  certificates: many(certificate),
  education: many(doctorEducation),
  user: one(user, {
    fields: [doctor.userId],
    references: [user.id],
  }),
  availabilities: many(doctorAvailability),
}));
