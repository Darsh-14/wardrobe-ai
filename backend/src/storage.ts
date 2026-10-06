// Photo storage. Database columns hold object paths ("<user_id>/<file>"); the API turns them into
// short-lived signed URLs. Values that are already URLs (the seed's Unsplash photos) pass through.
import { createClient } from "@supabase/supabase-js"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, normalize } from "node:path"
import type { Config } from "./config.js"

export type Bucket = "wardrobe" | "looks" | "avatars"

export interface Storage {
  upload(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** Map of path -> URL for display. Missing/empty paths are skipped. */
  urls(bucket: Bucket, paths: (string | null | undefined)[]): Promise<Map<string, string>>
  read?(bucket: Bucket, path: string): Promise<Uint8Array>
  /** File bytes and type; paths that are URLs (seed photos) are fetched. */
  download(bucket: Bucket, path: string): Promise<{ bytes: Uint8Array; contentType: string }>
  remove(bucket: Bucket, paths: string[]): Promise<void>
}

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }
const typeOf = (path: string) => TYPES[path.split("?")[0].split(".").pop()?.toLowerCase() ?? ""] ?? "image/jpeg"

async function fetchUrl(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? typeOf(url) }
}

const SIGNED_URL_TTL = 60 * 60 // 1 hour

const isUrl = (p: string) => /^https?:\/\//.test(p)

export function createStorage(config: Config): Storage {
  return config.STORAGE_DRIVER === "local" ? localStorage(config) : supabaseStorage(config)
}

function supabaseStorage(config: Config): Storage {
  const client = createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async upload(bucket, path, bytes, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: true })
      if (error) throw new Error(`Storage upload failed: ${error.message}`)
    },
    async urls(bucket, paths) {
      const out = new Map<string, string>()
      const toSign: string[] = []
      for (const p of new Set(paths)) {
        if (!p) continue
        if (isUrl(p)) out.set(p, p)
        else toSign.push(p)
      }
      if (toSign.length) {
        const { data, error } = await client.storage.from(bucket).createSignedUrls(toSign, SIGNED_URL_TTL)
        if (error) throw new Error(`Signing URLs failed: ${error.message}`)
        for (const row of data) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl)
      }
      return out
    },
    async download(bucket, path) {
      if (isUrl(path)) return fetchUrl(path)
      const { data, error } = await client.storage.from(bucket).download(path)
      if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`)
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || typeOf(path) }
    },
    async remove(bucket, paths) {
      const own = paths.filter((p) => p && !isUrl(p))
      if (!own.length) return
      const { error } = await client.storage.from(bucket).remove(own)
      if (error) throw new Error(`Storage delete failed: ${error.message}`)
    },
  }
}

// Dev-only driver: files on disk, served by the API at /files/<bucket>/<path> without auth.
function localStorage(config: Config): Storage {
  const root = config.LOCAL_STORAGE_DIR
  const safe = (bucket: string, path: string) => {
    const p = normalize(path)
    if (p.startsWith("..") || p.startsWith("/")) throw new Error("bad path")
    return join(root, bucket, p)
  }
  return {
    async upload(bucket, path, bytes) {
      const file = safe(bucket, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, bytes)
    },
    async urls(bucket, paths) {
      const out = new Map<string, string>()
      for (const p of paths) {
        if (p) out.set(p, isUrl(p) ? p : `${config.PUBLIC_URL}/files/${bucket}/${p}`)
      }
      return out
    },
    read: (bucket, path) => readFile(safe(bucket, path)),
    download: async (bucket, path) =>
      isUrl(path) ? fetchUrl(path) : { bytes: await readFile(safe(bucket, path)), contentType: typeOf(path) },
    async remove(bucket, paths) {
      for (const p of paths) if (p && !isUrl(p)) await rm(safe(bucket, p), { force: true })
    },
  }
}
