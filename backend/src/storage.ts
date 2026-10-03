// Photo storage. Database columns hold object paths ("<user_id>/<file>"); the API turns them into
// short-lived signed URLs. Values that are already URLs (the seed's Unsplash photos) pass through.
import { createClient } from "@supabase/supabase-js"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, normalize } from "node:path"
import type { Config } from "./config.js"

export type Bucket = "wardrobe" | "looks" | "avatars"

export interface Storage {
  upload(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** Map of path -> URL for display. Missing/empty paths are skipped. */
  urls(bucket: Bucket, paths: (string | null | undefined)[]): Promise<Map<string, string>>
  read?(bucket: Bucket, path: string): Promise<Uint8Array>
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
  }
}
