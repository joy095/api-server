import { HTTPException } from "hono/http-exception";

export function buildKey(folder: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
}

// -------------------------

type UploadResult = {
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export async function uploadToR2(
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

// ------------------------

export function extFromMime(mime: string): string {
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


export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
