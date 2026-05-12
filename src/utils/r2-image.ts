// utils/r2-image.ts
import { SQL } from "drizzle-orm";
import { createDb } from "../db";
import {
  ALLOWED_IMAGE_TYPES,
  buildKey,
  extFromMime,
  uploadToR2,
} from "../utils";
import { MAX_IMAGE_BYTES } from "../const";

// Always derived from the real createDb — stays in sync automatically
export type Db = ReturnType<typeof createDb>;

export async function deleteFromR2(
  bucket: R2Bucket,
  key: string | null | undefined,
) {
  if (key) await bucket.delete(key);
}

export async function replaceImage(
  db: Db,
  bucket: R2Bucket,
  file: File,
  r2Folder: string,
  table: Parameters<Db["update"]>[0],
  imageColumn: string,
  whereClause: SQL,
  oldKey: string | null,
) {
  const key = buildKey(
    r2Folder,
    `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extFromMime(file.type)}`,
  );

  const result = await uploadToR2(
    bucket,
    key,
    file,
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_BYTES,
  );

  await deleteFromR2(bucket, oldKey);

  await db
    .update(table)
    .set({ [imageColumn]: result.key } as Record<string, unknown>)
    .where(whereClause);

  return result;
}

export async function removeImage(
  db: Db,
  bucket: R2Bucket,
  key: string,
  table: Parameters<Db["update"]>[0],
  imageColumn: string,
  whereClause: SQL,
) {
  await bucket.delete(key);

  await db
    .update(table)
    .set({ [imageColumn]: null } as Record<string, unknown>)
    .where(whereClause);
}

export async function deleteImageIfExists(
  db: Db,
  bucket: R2Bucket,
  table: Parameters<Db["update"]>[0],
  imageColumn: string,
  whereClause: SQL,
  imageKey: string | null | undefined,
): Promise<boolean> {
  if (!imageKey) return false;
  await removeImage(db, bucket, imageKey, table, imageColumn, whereClause);
  return true;
}
