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
import { organization } from "../db/schema/auth-schema";
import { eq } from "drizzle-orm";
import { requireSession } from "../middleware/sessionMiddleware";
import { requireOrgRole } from "../middleware/requireOrgRole";

type AppEnv = { Bindings: Bindings };

const orgImage = new Hono<AppEnv>();

orgImage.post("/", requireSession, requireOrgRole("owner"), async (c) => {
  const db = createDb(c.env);

  const session = c.get("session");

  const orgId = session.activeOrganizationId;

  if (!orgId) {
    throw new HTTPException(400, { message: "No active organization" });
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

  const oldKey = org.logo ?? null;

  const key = buildKey(
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

  if (oldKey) {
    await c.env.R2_BUCKET.delete(oldKey);
  }

  await db
    .update(organization)
    .set({ logo: result.key })
    .where(eq(organization.id, orgId));

  return c.json(
    {
      success: true,
      data: result,
      replaced: !!oldKey,
    },
    201,
  );
});

orgImage.delete("/", requireSession, requireOrgRole("owner"), async (c) => {
  const db = createDb(c.env);

  const session = c.get("session");

  const orgId = session.activeOrganizationId;

  if (!orgId) {
    throw new HTTPException(400, { message: "No active organization" });
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
