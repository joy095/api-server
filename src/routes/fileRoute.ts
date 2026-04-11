import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "..";

// ─── Constants ────────────────────────────────────────────────────────────────

const FOLDERS = {
  images: "images",
  docs: "documents",
} as const;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_DOC_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20 MB

type AppEnv = { Bindings: Bindings };

const uploads = new Hono<AppEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildKey(folder: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
  };
  return map[mime] ?? "bin";
}

type UploadResult = {
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  file: File,
  allowedTypes: Set<string>,
  maxBytes: number,
): Promise<UploadResult> {
  if (!allowedTypes.has(file.type)) {
    throw new HTTPException(415, {
      message: `Unsupported type "${file.type}". Allowed: ${[...allowedTypes].join(", ")}`,
    });
  }
  if (file.size === 0) {
    throw new HTTPException(400, { message: "File is empty" });
  }
  if (file.size > maxBytes) {
    throw new HTTPException(413, {
      message: `File too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Max: ${maxBytes / 1024 / 1024} MB`,
    });
  }

  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type,
      contentDisposition: `inline; filename="${file.name}"`,
    },
    customMetadata: {
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
      sizeBytes: String(file.size),
    },
  });

  return {
    key,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

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
