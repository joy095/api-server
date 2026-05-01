import { Hono } from "hono";
import { Bindings } from "..";
import { createDb } from "../db";
import { requireOrgRole } from "../middleware/requireOrgRole";
import { requireSession } from "../middleware/sessionMiddleware";
import { HTTPException } from "hono/http-exception";
import {
  appointment,
  certificate,
  doctor,
  doctorClinic,
  doctorExperience,
} from "../db/schema/org-schema";
import { eq, and } from "drizzle-orm";
import {
  array,
  check,
  integer,
  maxValue,
  minValue,
  nullable,
  number,
  object,
  optional,
  picklist,
  pipe,
  string,
  uuid,
} from "valibot";
import { sValidator } from "@hono/standard-validator";

type AppEnv = { Bindings: Bindings };

const orgRoute = new Hono<AppEnv>();

// ─── Validators ───────────────────────────────────────────────────────────────

const CreateDoctorExperienceSchema = object({
  organization: pipe(
    string(),
    check((v) => v.length <= 255, "Max 255 chars"),
  ),
  description: optional(nullable(string())),
  startDate: string(), // ISO date string "YYYY-MM-DD"
  endDate: string(),
});

const CreateCertificateSchema = object({
  name: pipe(
    string(),
    check((v) => v.length <= 100, "Max 100 chars"),
  ),
  description: optional(nullable(string())),
  issuedAt: string(),
  expiresAt: optional(nullable(string())),
});

const CreateDoctorSchema = object({
  name: pipe(
    string(),
    check((v) => v.trim().length > 0, "Name is required"),
  ),
  description: pipe(
    string(),
    check((v) => v.trim().length > 0, "Description is required"),
  ),
  specialized: optional(
    nullable(
      pipe(
        string(),
        check((v) => v.length <= 50, "Max 50 chars"),
      ),
    ),
  ),
  slotDurationMins: optional(
    pipe(number(), integer(), minValue(5), maxValue(120)),
  ),
  experience: CreateDoctorExperienceSchema,
  certificates: array(CreateCertificateSchema),
});

const UpdateDoctorSchema = object({
  name: optional(
    pipe(
      string(),
      check((v) => v.trim().length > 0, "Name is required"),
    ),
  ),
  description: optional(
    pipe(
      string(),
      check((v) => v.trim().length > 0, "Description is required"),
    ),
  ),
  specialized: optional(
    nullable(
      pipe(
        string(),
        check((v) => v.length <= 50, "Max 50 chars"),
      ),
    ),
  ),
  slotDurationMins: optional(
    pipe(number(), integer(), minValue(5), maxValue(120)),
  ),
  image: optional(nullable(string())),
});

const UpsertClinicSchema = object({
  bookingDate: pipe(
    string(),
    check((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Must be YYYY-MM-DD"),
  ),
});

const AdvanceQueueSchema = object({
  doctorClinicId: pipe(string(), uuid()),
});

const CreateAppointmentSchema = object({
  doctorId: pipe(string(), uuid()),
  bookingDate: pipe(
    string(),
    check((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Must be YYYY-MM-DD"),
  ),
  numberOfPatients: pipe(number(), integer(), minValue(1), maxValue(10)),
  appointmentDate: string(), // ISO timestamp
});

const UpdateAppointmentStatusSchema = object({
  status: picklist([
    "waiting",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
  ]),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Fetch a doctor row and verify the requesting user owns it */
async function getDoctorOrThrow(
  db: ReturnType<typeof createDb>,
  doctorId: string,
  userId: string,
) {
  const rows = await db
    .select()
    .from(doctor)
    .where(eq(doctor.id, doctorId))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Doctor not found" });
  }

  if (rows[0].userId !== userId) {
    throw new HTTPException(403, {
      message: "Only the doctor's own account can modify their profile",
    });
  }

  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /org/doctor
 * Create a doctor profile (org owner only).
 * The doctor profile will be linked to the authenticated user.
 */
orgRoute.post(
  "/doctor",
  requireSession,
  requireOrgRole("owner"),
  sValidator("json", CreateDoctorSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const body = c.req.valid("json");

    // 1. Create experience first (doctor FK → experience)
    const [exp] = await db
      .insert(doctorExperience)
      .values({
        organization: body.experience.organization,
        description: body.experience.description ?? null,
        startDate: body.experience.startDate,
        endDate: body.experience.endDate,
      })
      .returning();

    // 2. Create certificates
    const certIds: string[] = [];
    if (body.certificates.length > 0) {
      const certs = await db
        .insert(certificate)
        .values(
          body.certificates.map((cert) => ({
            name: cert.name,
            description: cert.description ?? null,
            issuedAt: cert.issuedAt,
            expiresAt: cert.expiresAt ?? null,
          })),
        )
        .returning({ id: certificate.id });

      certIds.push(...certs.map((c) => c.id));
    }

    // 3. Create the doctor
    const [newDoctor] = await db
      .insert(doctor)
      .values({
        name: body.name,
        description: body.description,
        specialized: body.specialized ?? null,
        slotDurationMins: body.slotDurationMins ?? 15,
        experienceId: exp.id,
        certificateId: certIds,
        userId,
      })
      .returning();

    return c.json({ success: true, doctor: newDoctor }, 201);
  },
);

/**
 * GET /org/doctor
 * List all doctors (any authenticated user).
 */
orgRoute.get("/doctor", requireSession, async (c) => {
  const db = createDb(c.env);
  const doctors = await db.select().from(doctor);
  return c.json({ success: true, doctors });
});

/**
 * GET /org/doctor/:id
 * Get a single doctor by ID (any authenticated user).
 */
orgRoute.get("/doctor/:id", requireSession, async (c) => {
  const db = createDb(c.env);
  const id = c.req.param("id");

  const rows = await db.select().from(doctor).where(eq(doctor.id, id)).limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Doctor not found" });
  }

  return c.json({ success: true, doctor: rows[0] });
});

/**
 * PATCH /org/doctor/:id
 * Update a doctor's profile.
 * Only the doctor's own user account may do this.
 */
orgRoute.patch(
  "/doctor/:id",
  requireSession,
  sValidator("json", UpdateDoctorSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const id = c.req.param("id");
    const body = c.req.valid("json");

    // Ownership check
    await getDoctorOrThrow(db, id, userId);

    const [updated] = await db
      .update(doctor)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && {
          description: body.description,
        }),
        ...(body.specialized !== undefined && {
          specialized: body.specialized,
        }),
        ...(body.slotDurationMins !== undefined && {
          slotDurationMins: body.slotDurationMins,
        }),
        ...(body.image !== undefined && { image: body.image }),
      })
      .where(eq(doctor.id, id))
      .returning();

    return c.json({ success: true, doctor: updated });
  },
);

/**
 * DELETE /org/doctor/:id
 * Delete a doctor profile.
 * Only the doctor's own user account may do this.
 */
orgRoute.delete("/doctor/:id", requireSession, async (c) => {
  const db = createDb(c.env);
  const session = c.get("session");
  const userId = session.userId as string;
  const id = c.req.param("id");

  await getDoctorOrThrow(db, id, userId);

  await db.delete(doctor).where(eq(doctor.id, id));

  return c.json({ success: true, message: "Doctor deleted" });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR CLINIC (queue counter) ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /org/clinic
 * Create or ensure a clinic counter row exists for a doctor on a given date.
 * Allowed: org owner OR the doctor themselves.
 */
orgRoute.post(
  "/clinic",
  requireSession,
  sValidator("json", UpsertClinicSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const { bookingDate } = c.req.valid("json");

    // Resolve doctorId – the caller must be the doctor or an org owner.
    // We look up a doctor row by userId first.
    const doctorRows = await db
      .select()
      .from(doctor)
      .where(eq(doctor.userId, userId))
      .limit(1);

    const isDoctor = doctorRows.length > 0;

    if (!isDoctor) {
      // Must be org owner (middleware would have already thrown for non-members,
      // but we still need to enforce the owner restriction here).
      // Re-use requireOrgRole logic by checking the session role.
      const role = (session as any).activeOrganizationRole as
        | string
        | undefined;
      if (role !== "owner") {
        throw new HTTPException(403, {
          message: "Only an org owner or the doctor can manage clinic counters",
        });
      }
      throw new HTTPException(400, {
        message:
          "Owner must specify a doctorId. Use POST /org/clinic/:doctorId instead.",
      });
    }

    const doctorId = doctorRows[0].id;

    const [clinic] = await db
      .insert(doctorClinic)
      .values({ doctorId, bookingDate })
      .onConflictDoNothing()
      .returning();

    // If onConflictDoNothing fired (row already existed) fetch it.
    const result =
      clinic ??
      (
        await db
          .select()
          .from(doctorClinic)
          .where(
            and(
              eq(doctorClinic.doctorId, doctorId),
              eq(doctorClinic.bookingDate, bookingDate),
            ),
          )
          .limit(1)
      )[0];

    return c.json({ success: true, clinic: result }, 201);
  },
);

/**
 * POST /org/clinic/:doctorId
 * Org owner explicitly creates/ensures a clinic counter for any doctor.
 */
orgRoute.post(
  "/clinic/:doctorId",
  requireSession,
  requireOrgRole("owner"),
  sValidator("json", UpsertClinicSchema),
  async (c) => {
    const db = createDb(c.env);
    const doctorId = c.req.param("doctorId");
    const { bookingDate } = c.req.valid("json");

    // Make sure doctor exists
    const doctorRows = await db
      .select()
      .from(doctor)
      .where(eq(doctor.id, doctorId))
      .limit(1);

    if (!doctorRows.length) {
      throw new HTTPException(404, { message: "Doctor not found" });
    }

    const [clinic] = await db
      .insert(doctorClinic)
      .values({ doctorId, bookingDate })
      .onConflictDoNothing()
      .returning();

    const result =
      clinic ??
      (
        await db
          .select()
          .from(doctorClinic)
          .where(
            and(
              eq(doctorClinic.doctorId, doctorId),
              eq(doctorClinic.bookingDate, bookingDate),
            ),
          )
          .limit(1)
      )[0];

    return c.json({ success: true, clinic: result }, 201);
  },
);

/**
 * GET /org/clinic/:doctorId/:date
 * Get the clinic counter for a doctor on a specific date.
 * Any authenticated user can view queue status.
 */
orgRoute.get("/clinic/:doctorId/:date", requireSession, async (c) => {
  const db = createDb(c.env);
  const doctorId = c.req.param("doctorId");
  const date = c.req.param("date");

  const rows = await db
    .select()
    .from(doctorClinic)
    .where(
      and(
        eq(doctorClinic.doctorId, doctorId),
        eq(doctorClinic.bookingDate, date),
      ),
    )
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Clinic counter not found" });
  }

  return c.json({ success: true, clinic: rows[0] });
});

/**
 * POST /org/clinic/advance
 * Advance the currentNumber (call next patient in queue).
 * Allowed: org owner OR the doctor whose clinic it is.
 */
orgRoute.post(
  "/clinic/advance",
  requireSession,
  sValidator("json", AdvanceQueueSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const { doctorClinicId } = c.req.valid("json");

    // Fetch clinic row
    const clinicRows = await db
      .select()
      .from(doctorClinic)
      .where(eq(doctorClinic.id, doctorClinicId))
      .limit(1);

    if (!clinicRows.length) {
      throw new HTTPException(404, { message: "Clinic counter not found" });
    }

    const clinicRow = clinicRows[0];

    // Authorization: must be org owner OR the doctor linked to this clinic
    const doctorRows = await db
      .select()
      .from(doctor)
      .where(eq(doctor.id, clinicRow.doctorId))
      .limit(1);

    const isDoctor = doctorRows.length > 0 && doctorRows[0].userId === userId;
    const role = (session as any).activeOrganizationRole as string | undefined;
    const isOwner = role === "owner";

    if (!isDoctor && !isOwner) {
      throw new HTTPException(403, {
        message: "Only the clinic owner or the doctor can advance the queue",
      });
    }

    if (clinicRow.currentNumber >= clinicRow.lastNumber) {
      throw new HTTPException(400, {
        message: "No more patients in the queue",
      });
    }

    const [updated] = await db
      .update(doctorClinic)
      .set({ currentNumber: clinicRow.currentNumber + 1 })
      .where(eq(doctorClinic.id, doctorClinicId))
      .returning();

    return c.json({ success: true, clinic: updated });
  },
);

/**
 * POST /org/clinic/reset
 * Reset currentNumber and lastNumber to 0 for a new day.
 * Allowed: org owner OR the doctor.
 */
orgRoute.post(
  "/clinic/reset",
  requireSession,
  sValidator("json", AdvanceQueueSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const { doctorClinicId } = c.req.valid("json");

    const clinicRows = await db
      .select()
      .from(doctorClinic)
      .where(eq(doctorClinic.id, doctorClinicId))
      .limit(1);

    if (!clinicRows.length) {
      throw new HTTPException(404, { message: "Clinic counter not found" });
    }

    const clinicRow = clinicRows[0];
    const doctorRows = await db
      .select()
      .from(doctor)
      .where(eq(doctor.id, clinicRow.doctorId))
      .limit(1);

    const isDoctor = doctorRows.length > 0 && doctorRows[0].userId === userId;
    const role = (session as any).activeOrganizationRole as string | undefined;
    const isOwner = role === "owner";

    if (!isDoctor && !isOwner) {
      throw new HTTPException(403, {
        message: "Only the clinic owner or the doctor can reset the queue",
      });
    }

    const [updated] = await db
      .update(doctorClinic)
      .set({ currentNumber: 0, lastNumber: 0 })
      .where(eq(doctorClinic.id, doctorClinicId))
      .returning();

    return c.json({ success: true, clinic: updated });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// APPOINTMENT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /org/appointment
 * Patient books an appointment.
 * Atomically increments lastNumber on the clinic counter.
 */
orgRoute.post(
  "/appointment",
  requireSession,
  sValidator("json", CreateAppointmentSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const patientId = session.userId as string;
    const body = c.req.valid("json");

    // 1. Verify doctor exists
    const doctorRows = await db
      .select()
      .from(doctor)
      .where(eq(doctor.id, body.doctorId))
      .limit(1);

    if (!doctorRows.length) {
      throw new HTTPException(404, { message: "Doctor not found" });
    }

    // 2. Ensure clinic counter row exists for this date
    await db
      .insert(doctorClinic)
      .values({ doctorId: body.doctorId, bookingDate: body.bookingDate })
      .onConflictDoNothing();

    // 3. Atomically increment lastNumber and get it back
    const [clinicRow] = await db
      .update(doctorClinic)
      .set({
        lastNumber: sql`last_number + 1`,
      } as any)
      .where(
        and(
          eq(doctorClinic.doctorId, body.doctorId),
          eq(doctorClinic.bookingDate, body.bookingDate),
        ),
      )
      .returning();

    const bookingNumber = clinicRow.lastNumber;

    // 4. Insert appointment
    const [newAppointment] = await db
      .insert(appointment)
      .values({
        doctorId: body.doctorId,
        patientId,
        numberOfPatients: body.numberOfPatients,
        bookingNumber,
        bookingDate: body.bookingDate,
        appointmentDate: new Date(body.appointmentDate),
        status: "waiting",
      })
      .returning();

    return c.json(
      {
        success: true,
        appointment: newAppointment,
        bookingNumber,
        message: `Your booking number is ${bookingNumber}`,
      },
      201,
    );
  },
);

/**
 * GET /org/appointment/my
 * Patient views their own appointments.
 */
orgRoute.get("/appointment/my", requireSession, async (c) => {
  const db = createDb(c.env);
  const session = c.get("session");
  const patientId = session.userId as string;

  const appointments = await db
    .select()
    .from(appointment)
    .where(eq(appointment.patientId, patientId));

  return c.json({ success: true, appointments });
});

/**
 * GET /org/appointment/doctor/:doctorId/:date
 * Org owner or the doctor sees all appointments for a given day.
 */
orgRoute.get(
  "/appointment/doctor/:doctorId/:date",
  requireSession,
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const doctorId = c.req.param("doctorId");
    const date = c.req.param("date");

    // Authorization: org owner OR the doctor themselves
    const doctorRows = await db
      .select()
      .from(doctor)
      .where(eq(doctor.id, doctorId))
      .limit(1);

    if (!doctorRows.length) {
      throw new HTTPException(404, { message: "Doctor not found" });
    }

    const isDoctor = doctorRows[0].userId === userId;
    const role = (session as any).activeOrganizationRole as string | undefined;
    const isOwner = role === "owner";

    if (!isDoctor && !isOwner) {
      throw new HTTPException(403, {
        message:
          "Only the clinic owner or the doctor can view all appointments",
      });
    }

    const appointments = await db
      .select()
      .from(appointment)
      .where(
        and(
          eq(appointment.doctorId, doctorId),
          eq(appointment.bookingDate, date),
        ),
      );

    return c.json({ success: true, appointments });
  },
);

/**
 * GET /org/appointment/:id
 * View a single appointment.
 * Patient can only view their own; doctor/owner can view any.
 */
orgRoute.get("/appointment/:id", requireSession, async (c) => {
  const db = createDb(c.env);
  const session = c.get("session");
  const userId = session.userId as string;
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(appointment)
    .where(eq(appointment.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Appointment not found" });
  }

  const appt = rows[0];

  // Check if the user is the patient
  if (appt.patientId === userId) {
    return c.json({ success: true, appointment: appt });
  }

  // Check if the user is the doctor
  const doctorRows = await db
    .select()
    .from(doctor)
    .where(and(eq(doctor.id, appt.doctorId), eq(doctor.userId, userId)))
    .limit(1);

  const role = (session as any).activeOrganizationRole as string | undefined;
  const isOwner = role === "owner";

  if (!doctorRows.length && !isOwner) {
    throw new HTTPException(403, {
      message: "You do not have access to this appointment",
    });
  }

  return c.json({ success: true, appointment: appt });
});

/**
 * PATCH /org/appointment/:id/status
 * Update appointment status.
 * Patient can cancel their own. Doctor/owner can set any status.
 */
orgRoute.patch(
  "/appointment/:id/status",
  requireSession,
  sValidator("json", UpdateAppointmentStatusSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const id = c.req.param("id");
    const { status } = c.req.valid("json");

    const rows = await db
      .select()
      .from(appointment)
      .where(eq(appointment.id, id))
      .limit(1);

    if (!rows.length) {
      throw new HTTPException(404, { message: "Appointment not found" });
    }

    const appt = rows[0];
    const isPatient = appt.patientId === userId;

    // Patients can only cancel
    if (isPatient && status !== "cancelled") {
      throw new HTTPException(403, {
        message: "Patients can only cancel their own appointments",
      });
    }

    if (!isPatient) {
      // Must be the doctor or org owner
      const doctorRows = await db
        .select()
        .from(doctor)
        .where(and(eq(doctor.id, appt.doctorId), eq(doctor.userId, userId)))
        .limit(1);

      const role = (session as any).activeOrganizationRole as
        | string
        | undefined;
      const isOwner = role === "owner";

      if (!doctorRows.length && !isOwner) {
        throw new HTTPException(403, {
          message:
            "Only the doctor or clinic owner can change appointment status",
        });
      }
    }

    const [updated] = await db
      .update(appointment)
      .set({ status })
      .where(eq(appointment.id, id))
      .returning();

    return c.json({ success: true, appointment: updated });
  },
);

/**
 * DELETE /org/appointment/:id
 * Cancel (delete) an appointment.
 * Patient can delete their own; org owner can delete any.
 */
orgRoute.delete("/appointment/:id", requireSession, async (c) => {
  const db = createDb(c.env);
  const session = c.get("session");
  const userId = session.userId as string;
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(appointment)
    .where(eq(appointment.id, id))
    .limit(1);

  if (!rows.length) {
    throw new HTTPException(404, { message: "Appointment not found" });
  }

  const appt = rows[0];
  const isPatient = appt.patientId === userId;
  const role = (session as any).activeOrganizationRole as string | undefined;
  const isOwner = role === "owner";

  if (!isPatient && !isOwner) {
    throw new HTTPException(403, {
      message: "Only the patient or clinic owner can delete an appointment",
    });
  }

  await db.delete(appointment).where(eq(appointment.id, id));

  return c.json({ success: true, message: "Appointment deleted" });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPERIENCE & CERTIFICATE ROUTES  (doctor-only modifications)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PATCH /org/doctor/:id/experience
 * Update a doctor's experience record.
 * Only the doctor's own user may do this.
 */
orgRoute.patch(
  "/doctor/:id/experience",
  requireSession,
  sValidator(
    "json",
    object({
      organization: optional(
        pipe(
          string(),
          check((v) => v.length <= 255, "Max 255"),
        ),
      ),
      description: optional(nullable(string())),
      startDate: optional(string()),
      endDate: optional(string()),
    }),
  ),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const doc = await getDoctorOrThrow(db, id, userId);

    const [updated] = await db
      .update(doctorExperience)
      .set({
        ...(body.organization !== undefined && {
          organization: body.organization,
        }),
        ...(body.description !== undefined && {
          description: body.description,
        }),
        ...(body.startDate !== undefined && { startDate: body.startDate }),
        ...(body.endDate !== undefined && { endDate: body.endDate }),
      })
      .where(eq(doctorExperience.id, doc.experienceId))
      .returning();

    return c.json({ success: true, experience: updated });
  },
);

/**
 * POST /org/doctor/:id/certificate
 * Add a new certificate to a doctor's profile.
 * Only the doctor's own user may do this.
 */
orgRoute.post(
  "/doctor/:id/certificate",
  requireSession,
  sValidator("json", CreateCertificateSchema),
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const doc = await getDoctorOrThrow(db, id, userId);

    const [newCert] = await db
      .insert(certificate)
      .values({
        name: body.name,
        description: body.description ?? null,
        issuedAt: body.issuedAt,
        expiresAt: body.expiresAt ?? null,
      })
      .returning();

    // Append the new cert id to the doctor's certificateId array
    await db
      .update(doctor)
      .set({
        certificateId: [...doc.certificateId, newCert.id],
      })
      .where(eq(doctor.id, id));

    return c.json({ success: true, certificate: newCert }, 201);
  },
);

/**
 * DELETE /org/doctor/:id/certificate/:certId
 * Remove a certificate from a doctor's profile.
 * Only the doctor's own user may do this.
 */
orgRoute.delete(
  "/doctor/:id/certificate/:certId",
  requireSession,
  async (c) => {
    const db = createDb(c.env);
    const session = c.get("session");
    const userId = session.userId as string;
    const id = c.req.param("id");
    const certId = c.req.param("certId");

    const doc = await getDoctorOrThrow(db, id, userId);

    if (!doc.certificateId.includes(certId)) {
      throw new HTTPException(404, {
        message: "Certificate not found on this doctor",
      });
    }

    // Remove from array and delete the row
    await db
      .update(doctor)
      .set({
        certificateId: doc.certificateId.filter((cid) => cid !== certId),
      })
      .where(eq(doctor.id, id));

    await db.delete(certificate).where(eq(certificate.id, certId));

    return c.json({ success: true, message: "Certificate removed" });
  },
);

export default orgRoute;
