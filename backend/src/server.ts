import { existsSync } from "node:fs"
import { serve } from "@hono/node-server"
import { createImageAI } from "./ai/images.js"
import { claudeAsk } from "./ai/claude.js"
import { geminiAsk } from "./ai/gemini.js"
import { createMockStylist } from "./ai/mock.js"
import { createStylist } from "./ai/stylist.js"
import { createApp } from "./app.js"
import { loadConfig, type Config } from "./config.js"
import { createDb } from "./db.js"
import { Jobs, type Deps } from "./deps.js"
import { createStorage } from "./storage.js"
import { createWeather } from "./weather.js"

// local dev reads .env; hosts (Render) pass real environment variables instead
if (existsSync(".env")) process.loadEnvFile(".env")
const config: Config = await loadConfigOrServeError()

async function loadConfigOrServeError(): Promise<Config> {
  try {
    return loadConfig()
  } catch (err) {
    // Stay up and say what's wrong (in the logs and at /api/health) instead of crash-looping on the host
    const message = (err as Error).message
    console.error(message)
    const port = Number(process.env.PORT) || 8787
    // /api/health answers 200 so the host marks the deploy live and the error can be read there
    const fetch = (req: Request) =>
      Response.json({ ok: false, error: message }, { status: new URL(req.url).pathname === "/api/health" ? 200 : 503 })
    serve({ fetch, port }, () =>
      console.error(`Not configured; serving the error on port ${port}. Fix the environment variables and redeploy.`),
    )
    return new Promise<never>(() => {})
  }
}
const db = createDb(config.DATABASE_URL)
const deps: Deps = {
  config,
  db,
  storage: createStorage(config),
  stylist:
    config.AI_PROVIDER === "mock"
      ? createMockStylist()
      : createStylist(
          config.AI_PROVIDER === "claude"
            ? claudeAsk(config.ANTHROPIC_API_KEY!, config.CLAUDE_MODEL)
            : geminiAsk(config.GEMINI_API_KEY!, [config.GEMINI_MODEL, ...config.GEMINI_FALLBACK_MODELS.split(",").map((m) => m.trim())]),
        ),
  images: createImageAI({
    replicateToken: config.REPLICATE_API_TOKEN,
    replicateImageModel: config.REPLICATE_IMAGE_MODEL,
    replicateBgModel: config.REPLICATE_BG_REMOVAL_MODEL,
    geminiKey: config.GEMINI_IMAGE_API_KEY || config.GEMINI_API_KEY,
    geminiImageModel: config.GEMINI_IMAGE_MODEL,
    geminiImageUse: config.GEMINI_IMAGE_USE,
    cloudflare: config.CLOUDFLARE_ACCOUNT_ID && config.CLOUDFLARE_API_TOKEN
      ? { accountId: config.CLOUDFLARE_ACCOUNT_ID, token: config.CLOUDFLARE_API_TOKEN, model: config.CLOUDFLARE_IMAGE_MODEL, editModel: config.CLOUDFLARE_EDIT_MODEL, tryOnModel: config.CLOUDFLARE_TRYON_MODEL }
      : undefined,
    freeImages: config.FREE_IMAGES,
    pollinationsUrl: config.POLLINATIONS_URL,
  }),
  weather: createWeather(db, config.WEATHER_PROVIDER),
  jobs: new Jobs(),
}

const server = serve({ fetch: createApp(deps).fetch, port: config.PORT }, (info) =>
  console.log(`Wardrobe AI API on http://localhost:${info.port} (AI: ${config.AI_PROVIDER}, storage: ${config.STORAGE_DRIVER})`),
)

// say clearly in the host's logs whether the database is reachable
db.sql`select 1`.then(
  () => console.log("Database connection OK"),
  (err: Error) => console.error(`Database connection FAILED: ${err.message} (check DATABASE_URL)`),
)

const shutdown = async () => {
  server.close()
  await deps.jobs.idle()
  await db.end()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
