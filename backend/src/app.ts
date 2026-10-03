// Builds the HTTP app. Every /api route except /api/auth/* and /api/health needs a Supabase access token.
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { authRoutes, createVerifier, requireAuth, type AuthEnv } from "./auth.js"
import type { Deps } from "./deps.js"
import { onError } from "./http.js"
import { lookRoutes } from "./routes/looks.js"
import { meRoutes } from "./routes/me.js"
import { stylistRoutes } from "./routes/stylist.js"
import { trendRoutes } from "./routes/trends.js"
import { wardrobeRoutes } from "./routes/wardrobe.js"

export function createApp(deps: Deps, opts: { log?: boolean } = {}) {
  const { config } = deps
  const app = new Hono()
  if (opts.log !== false) app.use(logger())
  app.use(
    "/api/*",
    cors({
      origin: config.CORS_ORIGINS.split(",").map((s) => s.trim()),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  )
  app.onError(onError)
  app.notFound((c) => c.json({ error: "Not found" }, 404))

  // Always 200 once the server is up, so a host's health check passes and the problem can be read here
  app.get("/api/health", async (c) => {
    // answer within a few seconds even when the database hangs, so the host's health check doesn't time out
    const timeout = new Promise<string>((r) => setTimeout(() => r("error: no answer from the database within 3s"), 3000))
    const database = await Promise.race([
      deps.db.sql`select 1`.then(
        () => "ok",
        (err: Error) => `error: ${err.message}`,
      ),
      timeout,
    ])
    return c.json({ ok: database === "ok", database, ai: config.AI_PROVIDER, images: deps.images.enabled, storage: config.STORAGE_DRIVER })
  })
  app.route("/api/auth", authRoutes(config))

  const api = new Hono<AuthEnv>()
  api.use(requireAuth(createVerifier(config)))
  const { recs, shopping } = stylistRoutes(deps)
  api.route("/", meRoutes(deps))
  api.route("/wardrobe", wardrobeRoutes(deps))
  api.route("/looks", lookRoutes(deps))
  api.route("/trends", trendRoutes(deps))
  api.route("/recommendations", recs)
  api.route("/shopping", shopping)
  app.route("/api", api)

  if (config.STORAGE_DRIVER === "local") {
    // dev only: serve uploaded files from disk
    app.use("/files/*", serveStatic({ root: config.LOCAL_STORAGE_DIR, rewriteRequestPath: (p) => p.replace(/^\/files/, "") }))
  }
  if (config.STATIC_DIR) {
    // the web app: real files first, then index.html for everything else (the app has no URL routes)
    const root = config.STATIC_DIR
    const index = serveStatic({ root, path: "index.html" })
    app.use("*", serveStatic({ root }))
    app.get("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : index(c, next)))
  }
  return app
}
