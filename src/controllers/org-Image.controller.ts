// org-image.ts
import { Context } from "hono";
import { replaceImage, removeImage } from "../utils/r2-image";
import { createDb } from "../db";
import { badRequest, notFound } from "../utils/errors";
import { eq } from "drizzle-orm";
import { organization } from "../db/schema/auth-schema";
import { Bindings } from "..";

type AppEnv = { Bindings: Bindings };

export async function uploadOrgImage(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const orgId = c.get("session").activeOrganizationId;
  if (!orgId) throw badRequest("No active organization");

  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File)) throw badRequest('Field "file" is required');

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, orgId),
  });
  if (!org) throw notFound("Organization not found");

  const result = await replaceImage(
    db,
    c.env.R2_BUCKET,
    file,
    `org/${orgId}/logo`,
    organization,
    "logo",
    eq(organization.id, orgId),
    org.logo ?? null,
  );

  return c.json({ success: true, data: result, replaced: !!org.logo }, 201);
}

export async function deleteOrgImage(c: Context<AppEnv>) {
  const db = createDb(c.env);
  const orgId = c.get("session").activeOrganizationId;
  if (!orgId) throw badRequest("No active organization");

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, orgId),
  });
  if (!org) throw notFound("Organization not found");
  if (!org.logo) throw notFound("No logo found");

  await removeImage(
    db,
    c.env.R2_BUCKET,
    org.logo,
    organization,
    "logo",
    eq(organization.id, orgId),
  );

  return c.json({ success: true, message: "Organization logo deleted" });
}
