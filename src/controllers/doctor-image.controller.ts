// doctor-image.ts
import { Context } from "hono";
import { replaceImage, removeImage } from "../utils/r2-image";

import { createDb } from "../db";
import { badRequest, notFound } from "../utils/errors";
import {
  certificate,
  doctor,
  doctorExperience,
} from "../db/schema/doctor-schema";
import { and, eq } from "drizzle-orm";
import { Bindings } from "..";

type AppEnv = { Bindings: Bindings };

export async function uploadCertificateImage(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const certificateId = c.req.param("certificateId");
  if (!certificateId) throw badRequest("Certificate ID is required");

  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File)) throw badRequest('Field "file" is required');

  const doctorData = (
    await db.select().from(doctor).where(eq(doctor.userId, userId)).limit(1)
  )[0];
  if (!doctorData) throw notFound("Doctor profile not found");

  const cert = (
    await db
      .select()
      .from(certificate)
      .where(
        and(
          eq(certificate.id, certificateId),
          eq(certificate.doctorId, doctorData.id),
        ),
      )
      .limit(1)
  )[0];
  if (!cert) throw notFound("Certificate not found");

  const result = await replaceImage(
    db,
    c.env.R2_BUCKET,
    file,
    `doctor/${doctorData.id}/certificate`,
    certificate,
    "image",
    eq(certificate.id, certificateId),
    cert.image ?? null,
  );

  return c.json({ success: true, data: result, replaced: !!cert.image }, 201);
}

export async function deleteCertificateImage(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const certificateId = c.req.param("certificateId");
  if (!certificateId) throw badRequest("Certificate ID is required");

  const doctorData = (
    await db.select().from(doctor).where(eq(doctor.userId, userId)).limit(1)
  )[0];
  if (!doctorData) throw notFound("Doctor profile not found");

  const cert = (
    await db
      .select()
      .from(certificate)
      .where(
        and(
          eq(certificate.id, certificateId),
          eq(certificate.doctorId, doctorData.id),
        ),
      )
      .limit(1)
  )[0];
  if (!cert) throw notFound("Certificate not found");
  if (!cert.image) throw notFound("Certificate image not found");

  await removeImage(
    db,
    c.env.R2_BUCKET,
    cert.image,
    certificate,
    "image",
    eq(certificate.id, certificateId),
  );

  return c.json({ success: true, message: "Certificate image deleted" });
}

export async function uploadExperienceImage(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const experienceId = c.req.param("experienceId");
  if (!experienceId) throw badRequest("Experience ID is required");

  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File)) throw badRequest('Field "file" is required');

  const doctorData = (
    await db.select().from(doctor).where(eq(doctor.userId, userId)).limit(1)
  )[0];
  if (!doctorData) throw notFound("Doctor profile not found");

  const exp = (
    await db
      .select()
      .from(doctorExperience)
      .where(
        and(
          eq(doctorExperience.id, experienceId),
          eq(doctorExperience.doctorId, doctorData.id),
        ),
      )
      .limit(1)
  )[0];
  if (!exp) throw notFound("Experience not found");

  const result = await replaceImage(
    db,
    c.env.R2_BUCKET,
    file,
    `doctor/${doctorData.id}/experience`,
    doctorExperience,
    "image",
    eq(doctorExperience.id, experienceId),
    exp.image ?? null,
  );

  return c.json({ success: true, data: result, replaced: !!exp.image }, 201);
}

export async function deleteExperienceImage(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const userId = c.get("user").id as string;
  const experienceId = c.req.param("experienceId");
  if (!experienceId) throw badRequest("Experience ID is required");

  const doctorData = (
    await db.select().from(doctor).where(eq(doctor.userId, userId)).limit(1)
  )[0];
  if (!doctorData) throw notFound("Doctor profile not found");

  const exp = (
    await db
      .select()
      .from(doctorExperience)
      .where(
        and(
          eq(doctorExperience.id, experienceId),
          eq(doctorExperience.doctorId, doctorData.id),
        ),
      )
      .limit(1)
  )[0];
  if (!exp) throw notFound("Experience not found");
  if (!exp.image) throw notFound("Experience image not found");

  await removeImage(
    db,
    c.env.R2_BUCKET,
    exp.image,
    doctorExperience,
    "image",
    eq(doctorExperience.id, experienceId),
  );

  return c.json({ success: true, message: "Experience image deleted" });
}
