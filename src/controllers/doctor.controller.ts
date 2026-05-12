import { Context } from "hono";
import { eq, and, isNull, or, ilike } from "drizzle-orm";
import { type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { createDb } from "../db";
import {
  doctor,
  certificate,
  doctorExperience,
} from "../db/schema/doctor-schema";
import { Bindings } from "..";
import {
  CreateExperienceSchema,
  UpdateExperienceSchema,
  CreateCertificateSchema,
  UpdateDoctorSchema,
  CreateDoctorSchema,
  UpdateCertificateSchema,
} from "../schema/doctor.schema";
import { user } from "../db/schema/auth-schema";
import { badRequest, forbidden, notFound } from "../utils/errors";
import { parse } from "valibot";
import { ensureNotEmptyPatch } from "../utils";
import { deleteImageIfExists } from "../utils/r2-image";

// ─── Drizzle row types ────────────────────────────────────────────────────────

type DoctorRow = InferSelectModel<typeof doctor>;
type DoctorInsert = InferInsertModel<typeof doctor>;
type ExperienceRow = InferSelectModel<typeof doctorExperience>;
type ExperienceInsert = InferInsertModel<typeof doctorExperience>;
type CertificateRow = InferSelectModel<typeof certificate>;
type CertificateInsert = InferInsertModel<typeof certificate>;

// ─── App env ──────────────────────────────────────────────────────────────────

type AppEnv = { Bindings: Bindings };
type Db = ReturnType<typeof createDb>;

// ─── Helper ───────────────────────────────────────────────────────────────────

export async function getDoctorOrThrow(
  db: Db,
  slug: string,
  userId: string,
): Promise<DoctorRow> {
  const rows = await db
    .select()
    .from(doctor)
    .where(
      and(
        eq(doctor.slug, slug), // Look up by SLUG string
        isNull(doctor.deletedAt),
      ),
    )
    .limit(1);

  if (!rows.length) {
    throw notFound("Doctor not found");
  }

  if (rows[0].userId !== userId) {
    throw forbidden("Only the doctor's own account can modify their profile");
  }

  return rows[0];
}

// ─── Doctor CRUD ──────────────────────────────────────────────────────────────

export async function createDoctor(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;

  const body = parse(CreateDoctorSchema, await c.req.json());

  if (body.slug) {
    const existing = await db
      .select({ id: doctor.id })
      .from(doctor)
      .where(eq(doctor.slug, body.slug))
      .limit(1);

    if (existing.length > 0) {
      throw badRequest("Slug is already taken");
    }
  }

  const values: DoctorInsert = {
    description: body.description,
    specialized: body.specialized ?? null,
    slotDurationMins: body.slotDurationMins ?? null,
    slug: body.slug,
    userId,
  };

  const [newDoctor] = await db.insert(doctor).values(values).returning();

  return c.json(
    {
      success: true,
      doctor: newDoctor,
    },
    201,
  );
}

export async function checkDoctorSlug(c: Context<AppEnv>) {
  const db = createDb(c.env);

  const slug = c.req.query("slug"); // ?slug=my-slug

  if (!slug) {
    return c.json(
      {
        success: false,
        message: "Slug query parameter is required",
      },
      400,
    );
  }

  const existing = await db
    .select({ id: doctor.id })
    .from(doctor)
    .where(eq(doctor.slug, slug))
    .limit(1);

  const isAvailable = existing.length === 0;

  return c.json({
    success: true,
    available: isAvailable,
    message: isAvailable ? "Slug is available" : "Slug is already taken",
  });
}

export async function getDoctor(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const searchTerm = c.req.param("slug"); // Rename variable for clarity

  if (!searchTerm) throw badRequest("Search term is required");

  const results = await db // Return an array of matches
    .select({
      id: doctor.id,
      specialized: doctor.specialized,
      slug: doctor.slug,
      description: doctor.description,
      slotDuration: doctor.slotDurationMins,
      user: {
        name: user.name,
        image: user.image,
      },
    })
    .from(doctor)
    .leftJoin(user, eq(doctor.userId, user.id))
    .where(
      and(
        isNull(doctor.deletedAt),
        or(
          ilike(user.name, `%${searchTerm}%`),
          ilike(doctor.specialized, `%${searchTerm}%`),
          ilike(doctor.slug, `%${searchTerm}%`),
        ),
      ),
    )
    .limit(10); // Return up to 10 matches

  if (results.length === 0) {
    throw notFound("No doctors found matching that search");
  }

  // Return the full array so mobile can show a list
  return c.json({ success: true, data: results });
}

export async function updateDoctor(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const slug = c.req.param("slug");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  const body = parse(UpdateDoctorSchema, await c.req.json());

  await getDoctorOrThrow(db, slug, userId);

  const patch: Partial<DoctorInsert> = {};

  if (body.description !== undefined) {
    patch.description = body.description;
  }

  if (body.specialized !== undefined) {
    patch.specialized = body.specialized;
  }

  if (body.slotDurationMins !== undefined) {
    patch.slotDurationMins = body.slotDurationMins;
  }

  ensureNotEmptyPatch(patch);

  const [updated] = await db

    .update(doctor)
    .set(patch)
    .where(eq(doctor.slug, slug))
    .returning({
      slug: doctor.slug,
      description: doctor.description,
      specialized: doctor.specialized,
      slotDurationMins: doctor.slotDurationMins,
      isActive: doctor.isActive,
      updatedAt: doctor.updatedAt,
    });

  return c.json({ success: true, doctor: updated });
}

export async function deleteDoctor(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const slug = c.req.param("slug");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  await getDoctorOrThrow(db, slug, userId);

  // Soft delete — preserves appointment & clinic history
  const softDelete = {
    deletedAt: new Date(),
    isActive: false,
  } satisfies Partial<DoctorInsert>;

  const [deleted] = await db
    .update(doctor)
    .set(softDelete)
    .where(eq(doctor.slug, slug))
    .returning({
      id: doctor.id, // Useful for the frontend to filter out of a list
      slug: doctor.slug, // To confirm which specific resource was hit
      deletedAt: doctor.deletedAt, // Proof of the timestamp of deletion
    });

  return c.json({ success: true, doctor: deleted });
}

// ─── Experience ───────────────────────────────────────────────────────────────

export async function listDoctorExperiences(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const slug = c.req.param("slug");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  // Confirm the doctor exists and is not soft-deleted before exposing data
  const doctorRows = await db
    .select()
    .from(doctor)
    .where(and(eq(doctor.slug, slug), isNull(doctor.deletedAt)))
    .limit(1);

  if (!doctorRows.length) {
    throw notFound("Doctor not found");
  }
  const id = doctorRows[0].id;
  const experiences: ExperienceRow[] = await db
    .select()
    .from(doctorExperience)
    .where(eq(doctorExperience.doctorId, id));

  return c.json({ success: true, experiences });
}

export async function addDoctorExperience(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const slug = c.req.param("slug");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  const body = parse(CreateExperienceSchema, await c.req.json());

  const doctorRow = await getDoctorOrThrow(db, slug, userId);

  const values: ExperienceInsert = {
    doctorId: doctorRow.id,
    organization: body.organization,
    description: body.description ?? null,
    startDate: body.startDate.toISOString().slice(0, 10),
    endDate: body.endDate ? body.endDate.toISOString().slice(0, 10) : null,
  };

  const [newExp] = await db.insert(doctorExperience).values(values).returning();

  return c.json({ success: true, experience: newExp }, 201);
}

export async function updateDoctorExperience(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const slug = c.req.param("slug");
  const expId = c.req.param("expId");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  if (!expId) {
    throw notFound("Experience ID is required");
  }

  const body = parse(UpdateExperienceSchema, await c.req.json());

  const doctorRow = await getDoctorOrThrow(db, slug, userId);

  const expRows = await db
    .select()
    .from(doctorExperience)
    .where(
      and(
        eq(doctorExperience.id, expId),
        eq(doctorExperience.doctorId, doctorRow.id),
      ),
    )
    .limit(1);

  if (!expRows.length) {
    throw notFound("Experience not found on this doctor");
  }

  const patch: Partial<ExperienceInsert> = {};

  if (body.organization !== undefined) {
    patch.organization = body.organization;
  }

  if (body.description !== undefined) {
    patch.description = body.description;
  }

  if (body.startDate !== undefined) {
    patch.startDate = body.startDate.toISOString().slice(0, 10);
  }

  if (body.endDate !== undefined) {
    patch.endDate = body.endDate
      ? body.endDate.toISOString().slice(0, 10)
      : null;
  }

  ensureNotEmptyPatch(patch);

  const [updated] = await db
    .update(doctorExperience)
    .set(patch)
    .where(eq(doctorExperience.id, expId))
    .returning();

  return c.json({ success: true, experience: updated });
}

// Delete experience with optional image cleanup from R2
export async function deleteDoctorExperience(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const slug = c.req.param("slug");
  const expId = c.req.param("expId");

  if (!slug) throw badRequest("Doctor slug is required");
  if (!expId) throw notFound("Experience ID is required");

  const doctorRow = await getDoctorOrThrow(db, slug, userId);

  const expRows = await db
    .select()
    .from(doctorExperience)
    .where(
      and(
        eq(doctorExperience.id, expId),
        eq(doctorExperience.doctorId, doctorRow.id),
      ),
    )
    .limit(1);

  if (!expRows.length) throw notFound("Experience not found on this doctor");

  await deleteImageIfExists(
    db,
    c.env.R2_BUCKET,
    doctorExperience,
    "image",
    eq(doctorExperience.id, expId),
    expRows[0].image,
  );

  await db.delete(doctorExperience).where(eq(doctorExperience.id, expId));

  return c.json({ success: true, message: "Experience removed" });
}

// ─── Certificate ──────────────────────────────────────────────────────────────

export async function listCertificates(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const slug = c.req.param("slug");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  const doctorRows = await db
    .select()
    .from(doctor)
    .where(and(eq(doctor.slug, slug), isNull(doctor.deletedAt)))
    .limit(1);

  if (!doctorRows.length) {
    throw notFound("Doctor not found");
  }

  const certificates: CertificateRow[] = await db
    .select()
    .from(certificate)
    .where(eq(certificate.doctorId, doctorRows[0].id));

  return c.json({ success: true, certificates });
}

export async function addCertificate(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const slug = c.req.param("slug");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  const body = parse(CreateCertificateSchema, await c.req.json());

  const doctorRow = await getDoctorOrThrow(db, slug, userId);

  const values: CertificateInsert = {
    doctorId: doctorRow.id,
    name: body.name,
    issuedAt: body.issuedAt.toISOString().slice(0, 10),
    expiresAt: body.expiresAt
      ? body.expiresAt.toISOString().slice(0, 10)
      : null,
  };

  const [newCert] = await db.insert(certificate).values(values).returning();

  return c.json({ success: true, certificate: newCert }, 201);
}

export async function updateCertificate(c: Context<AppEnv>) {
  const db = createDb(c.env);

  const userId = c.get("user").id as string;

  const slug = c.req.param("slug");

  const certId = c.req.param("certId");

  if (!slug) {
    throw badRequest("Doctor slug is required");
  }

  if (!certId) {
    throw badRequest("Certificate ID is required");
  }

  const body = parse(UpdateCertificateSchema, await c.req.json());

  const doctorRow = await getDoctorOrThrow(db, slug, userId);

  const certRows = await db
    .select()
    .from(certificate)
    .where(
      and(eq(certificate.id, certId), eq(certificate.doctorId, doctorRow.id)),
    )
    .limit(1);

  if (!certRows.length) {
    throw notFound("Certificate not found on this doctor");
  }

  const patch: Partial<CertificateInsert> = {};

  if (body.name !== undefined) {
    patch.name = body.name;
  }

  if (body.issuedAt !== undefined) {
    patch.issuedAt = body.issuedAt
      ? body.issuedAt.toISOString().slice(0, 10)
      : null;
  }

  if (body.expiresAt !== undefined) {
    patch.expiresAt = body.expiresAt
      ? body.expiresAt.toISOString().slice(0, 10)
      : null;
  }

  ensureNotEmptyPatch(patch);

  const [updated] = await db
    .update(certificate)
    .set(patch)
    .where(eq(certificate.id, certId))
    .returning();

  return c.json({
    success: true,
    certificate: updated,
  });
}

export async function deleteCertificate(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const slug = c.req.param("slug");
  const certId = c.req.param("certId");

  if (!slug) throw badRequest("Doctor slug is required");
  if (!certId) throw badRequest("Certificate ID is required");

  const doctorRow = await getDoctorOrThrow(db, slug, userId);

  const certRows = await db
    .select()
    .from(certificate)
    .where(
      and(eq(certificate.id, certId), eq(certificate.doctorId, doctorRow.id)),
    )
    .limit(1);

  if (!certRows.length) throw notFound("Certificate not found on this doctor");

  await deleteImageIfExists(
    db,
    c.env.R2_BUCKET,
    certificate,
    "image",
    eq(certificate.id, certId),
    certRows[0].image,
  );

  await db.delete(certificate).where(eq(certificate.id, certId));

  return c.json({ success: true, message: "Certificate removed" });
}
