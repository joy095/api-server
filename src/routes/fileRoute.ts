import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "..";
import {
  ALLOWED_IMAGE_TYPES,
  buildKey,
  extFromMime,
  uploadToR2,
} from "../utils";
import { MAX_DOC_BYTES, MAX_IMAGE_BYTES } from "../const";

// ─── Constants ────────────────────────────────────────────────────────────────

const FOLDERS = {
  images: "images",
  docs: "documents",
} as const;

const ALLOWED_DOC_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);



type AppEnv = { Bindings: Bindings };

const uploads = new Hono<AppEnv>();

// ─── Image Routes ─────────────────────────────────────────────────────────────

// POST /api/uploads/images  —  single image, max 5 MB
uploads.post("/images", async (c) => {
  const form = await c.req.formData().catch(() => {
    throw new HTTPException(400, { message: "Invalid multipart/form-data" });
  });

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'Field "file" is required' });
  }

  const key = buildKey(
    FOLDERS.images,
    `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extFromMime(file.type)}`,
  );
  const result = await uploadToR2(
    c.env.R2_BUCKET,
    key,
    file,
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_BYTES,
  );

  return c.json({ success: true, data: result }, 201);
});

// POST /api/uploads/images/batch  —  up to 5 images
uploads.post("/images/batch", async (c) => {
  const form = await c.req.formData().catch(() => {
    throw new HTTPException(400, { message: "Invalid multipart/form-data" });
  });

  const files = form
    .getAll("files[]")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    throw new HTTPException(400, {
      message: 'At least one file under "files[]" is required',
    });
  }
  if (files.length > 5) {
    throw new HTTPException(400, { message: "Maximum 5 images per batch" });
  }

  const results = await Promise.all(
    files.map((file) => {
      const key = buildKey(
        FOLDERS.images,
        `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extFromMime(file.type)}`,
      );
      return uploadToR2(
        c.env.R2_BUCKET,
        key,
        file,
        ALLOWED_IMAGE_TYPES,
        MAX_IMAGE_BYTES,
      );
    }),
  );

  return c.json({ success: true, data: results }, 201);
});

// ─── Document Routes ──────────────────────────────────────────────────────────

// POST /api/uploads/docs  —  single document, max 20 MB
uploads.post("/docs", async (c) => {
  const form = await c.req.formData().catch(() => {
    throw new HTTPException(400, { message: "Invalid multipart/form-data" });
  });

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'Field "file" is required' });
  }

  const key = buildKey(FOLDERS.docs, file.name);
  const result = await uploadToR2(
    c.env.R2_BUCKET,
    key,
    file,
    ALLOWED_DOC_TYPES,
    MAX_DOC_BYTES,
  );

  return c.json({ success: true, data: result }, 201);
});

// ─── Read / Delete Routes ─────────────────────────────────────────────────────

// GET /api/uploads/:key{.+}  —  stream any file from R2
uploads.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const object = await c.env.R2_BUCKET.get(key);
  if (!object) throw new HTTPException(404, { message: "File not found" });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

// DELETE /api/uploads/:key{.+}  —  delete any file from R2
uploads.delete("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const head = await c.env.R2_BUCKET.head(key);
  if (!head) throw new HTTPException(404, { message: "File not found" });

  await c.env.R2_BUCKET.delete(key);
  return c.json({ success: true, data: { key, deleted: true } });
});

export default uploads;
