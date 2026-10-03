// All settings come from environment variables (see .env.example).
import { z } from "zod"

const Env = z.object({
  PORT: z.coerce.number().default(8787),
  // Comma-separated list of origins allowed to call the API from a browser
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  // Public base URL of this API, used for locally stored files
  PUBLIC_URL: z.string().default("http://localhost:8787"),

  // Folder with the built frontend (gen ai `vite build` output). When set, the API also serves the
  // web app, so one service hosts both and the frontend calls /api on the same origin.
  STATIC_DIR: z.string().optional(),

  // Postgres connection (Supabase: Project Settings > Database > connection string, "Session" pooler)
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string (Supabase > Connect > Session pooler), not the https:// project URL"),

  // Supabase project. SUPABASE_JWT_SECRET verifies access tokens locally (HS256); without it the
  // API verifies against the project's JWKS at SUPABASE_URL/auth/v1/.well-known/jwks.json.
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),

  // "supabase" (Supabase Storage, signed URLs) or "local" (files on disk under LOCAL_STORAGE_DIR, dev only)
  STORAGE_DRIVER: z.enum(["supabase", "local"]).default("supabase"),
  LOCAL_STORAGE_DIR: z.string().default("./data/storage"),

  // "gemini" (free tier, default), "claude" (paid) or "mock" (deterministic answers, no keys needed)
  AI_PROVIDER: z.enum(["gemini", "claude", "mock"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  // Comma-separated models to try when GEMINI_MODEL is busy or rate limited (all free tier)
  GEMINI_FALLBACK_MODELS: z.string().default("gemini-3.5-flash,gemini-flash-lite-latest"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),

  // Image generation and background removal through Replicate. PAID, so off unless a token is set:
  // without one, looks show the first item's photo and scans keep the original photo.
  REPLICATE_API_TOKEN: z.string().optional(),
  REPLICATE_IMAGE_MODEL: z.string().default("black-forest-labs/flux-schnell"),
  REPLICATE_BG_REMOVAL_MODEL: z.string().default("851-labs/background-remover"),

  // "open-meteo" (free, no key) or "mock"
  WEATHER_PROVIDER: z.enum(["open-meteo", "mock"]).default("open-meteo"),
})

export type Config = z.infer<typeof Env>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // values pasted into a host's settings often carry stray spaces or a trailing newline
  const trimmed = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v?.trim()]))
  const parsed = Env.safeParse(trimmed)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ")
    throw new Error(`Invalid configuration:\n  ${issues}`)
  }
  const c = parsed.data
  if (!c.SUPABASE_JWT_SECRET && !c.SUPABASE_URL) {
    throw new Error("Set SUPABASE_JWT_SECRET or SUPABASE_URL so the API can verify access tokens")
  }
  if (c.AI_PROVIDER === "gemini" && !c.GEMINI_API_KEY) {
    throw new Error("AI_PROVIDER=gemini needs GEMINI_API_KEY (free at https://aistudio.google.com/apikey, or AI_PROVIDER=mock)")
  }
  if (c.AI_PROVIDER === "claude" && !c.ANTHROPIC_API_KEY) {
    throw new Error("AI_PROVIDER=claude needs ANTHROPIC_API_KEY (or set AI_PROVIDER=mock for local dev)")
  }
  if (c.STORAGE_DRIVER === "supabase" && !(c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  }
  return c
}
