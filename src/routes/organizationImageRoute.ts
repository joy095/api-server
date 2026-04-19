import { Hono } from "hono";
import { Bindings } from "..";
import { HTTPException } from "hono/http-exception";
import {
  ALLOWED_IMAGE_TYPES,
  buildKey,
  extFromMime,
  uploadToR2,
} from "../utils";
import { MAX_IMAGE_BYTES } from "../const";
import { createDb } from "../db";
import { organization, member } from "../db/schema/auth-schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../middleware/sessionMiddleware";

type AppEnv = { Bindings: Bindings };

const orgImage = new Hono<AppEnv>();

orgImage.post("/", requireSession, async (c) => {
  const db = createDb(c.env);

  const authUser = c.get("sessionUser");
  const session = c.get("session");

  const orgId = session.activeOrganizationId;

  if (!orgId) {
    throw new HTTPException(400, { message: "No active organization" });
  }

  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, orgId),
      eq(member.userId, authUser.id),
    ),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member" });
  }

  if (membership.role !== "owner") {
    throw new HTTPException(403, { message: "Only owner can update logo" });
  }

  const form = await c.req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'Field "file" is required' });
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, orgId),
  });

  if (!org) {
    throw new HTTPException(404, { message: "Organization not found" });
  }

  let key = org.logo
    ? org.logo
    : buildKey(
        `org/${orgId}/logo`,
        `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extFromMime(file.type)}`,
      );

  const result = await uploadToR2(
    c.env.R2_BUCKET,
    key,
    file,
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_BYTES,
  );

  await db
    .update(organization)
    .set({ logo: result.key })
    .where(eq(organization.id, orgId));

  return c.json(
    {
      success: true,
      data: result,
      replaced: !!org.logo,
    },
    201,
  );
});

orgImage.delete("/", requireSession, async (c) => {
  const db = createDb(c.env);

  const authUser = c.get("sessionUser");
  const session = c.get("session");

  const orgId = session.activeOrganizationId;

  if (!orgId) {
    throw new HTTPException(400, { message: "No active organization" });
  }

  // Check membership and role
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, orgId),
      eq(member.userId, authUser.id),
    ),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member" });
  }

  if (membership.role !== "owner") {
    throw new HTTPException(403, { message: "Only owner can delete logo" });
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, orgId),
  });

  if (!org) {
    throw new HTTPException(404, { message: "Organization not found" });
  }

  if (!org.logo) {
    throw new HTTPException(404, { message: "No logo found" });
  }

  await c.env.R2_BUCKET.delete(org.logo);

  await db
    .update(organization)
    .set({ logo: null })
    .where(eq(organization.id, orgId));

  return c.json({
    success: true,
    message: "Organization logo deleted",
  });
});

export default orgImage;
