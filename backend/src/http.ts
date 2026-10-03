import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HttpError(400, "Expected a JSON body")
  }
  return parseWith(schema, raw)
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parseWith(schema, c.req.query())
}

function parseWith<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
    throw new HttpError(400, msg)
  }
  return parsed.data
}

const Uuid = z.guid()

export function idParam(c: Context, name = "id"): string {
  const parsed = Uuid.safeParse(c.req.param(name))
  if (!parsed.success) throw new HttpError(404, "Not found")
  return parsed.data
}

export function onError(err: Error, c: Context) {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode)
  }
  // Postgres errors from RLS / constraints
  const code = (err as { code?: string }).code
  if (code === "P0002") return c.json({ error: "Not found" }, 404)
  if (code === "42501") return c.json({ error: "Not allowed" }, 403)
  if (code === "23503" || code === "23505" || code === "22P02") {
    return c.json({ error: "Invalid reference or duplicate" }, 400)
  }
  console.error(err)
  return c.json({ error: "Something went wrong" }, 500)
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

/** Reads the `file` field of a multipart upload and checks it is a JPEG/PNG/WebP under maxBytes. */
export async function readImageUpload(c: Context, maxBytes: number) {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    throw new HttpError(400, "Expected multipart/form-data with a `file` field")
  }
  const file = form.get("file")
  if (!(file instanceof File)) throw new HttpError(400, "Missing `file` field")
  const ext = IMAGE_TYPES[file.type]
  if (!ext) throw new HttpError(415, "Upload a JPEG, PNG or WebP photo")
  if (file.size > maxBytes) throw new HttpError(413, `Photo must be under ${Math.round(maxBytes / 1048576)} MB`)
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    mediaType: file.type as "image/jpeg" | "image/png" | "image/webp",
    ext,
  }
}
