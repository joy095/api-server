import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "..";

type AppEnv = { Bindings: Bindings };

const getFile = new Hono<AppEnv>();

// ─── Read / Delete Routes ─────────────────────────────────────────────────────

// GET /api/uploads/:key{.+}  —  stream any file from R2
getFile.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const object = await c.env.R2_BUCKET.get(key);
  if (!object) throw new HTTPException(404, { message: "File not found" });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

export default getFile;
