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
import { user } from "../db/schema/auth-schema";
import { eq } from "drizzle-orm";
import { verifyBetterAuthJWT } from "../middleware/authMiddleware";

type AppEnv = { Bindings: Bindings };

const userImage = new Hono<AppEnv>();

userImage.post("/", verifyBetterAuthJWT, async (c) => {
  const authUser = c.get("user");
  const db = createDb(c.env);

  const form = await c.req.formData().catch(() => {
    throw new HTTPException(400, { message: "Invalid multipart/form-data" });
  });

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'Field "file" is required' });
  }

  const existingUser = await db.query.user.findFirst({
    where: eq(user.id, authUser.id),
  });

  if (!existingUser || existingUser.id !== authUser.id) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const oldKey = existingUser.image ?? null;

  const key = buildKey(
    `users/${authUser.id}/images`,
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
    .update(user)
    .set({ image: result.key })
    .where(eq(user.id, authUser.id));

  return c.json(
    {
      success: true,
      data: result,
      replaced: !!oldKey,
    },
    201,
  );
});

userImage.delete("/", verifyBetterAuthJWT, async (c) => {
  const authUser = c.get("user");
  const db = createDb(c.env);

  const existingUser = await db.query.user.findFirst({
    where: eq(user.id, authUser.id),
  });

  if (!existingUser || existingUser.id !== authUser.id) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  if (!existingUser.image) {
    throw new HTTPException(404, { message: "No profile image found" });
  }

  await c.env.R2_BUCKET.delete(existingUser.image);

  await db.update(user).set({ image: null }).where(eq(user.id, authUser.id));

  return c.json({
    success: true,
    message: "Profile image deleted",
  });
});

export default userImage;
