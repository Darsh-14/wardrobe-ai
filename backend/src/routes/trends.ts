// GET /api/trends?location=  Trends are shared per city. When a city has none active, the AI
// writes a fresh set (one call serves everyone there) valid for 30 days.
import { Hono } from "hono"
import { z } from "zod"
import type { AuthEnv } from "../auth.js"
import type { Deps } from "../deps.js"
import { editorial } from "../ai/images.js"
import { HttpError, parseQuery } from "../http.js"
import { profile } from "../queries.js"

// Used until (or instead of) generated trend images
const STOCK = [
  "https://images.unsplash.com/photo-1616847220575-31b062a4cd05?auto=format&fit=crop&w=1000&q=86",
  "https://images.unsplash.com/photo-1721637686340-de9f8cebda5a?auto=format&fit=crop&w=1000&q=86",
  "https://images.unsplash.com/photo-1582164256364-b0eccb922bff?auto=format&fit=crop&w=1000&q=86",
  "https://images.unsplash.com/photo-1599330293364-622fa6bfcf3a?auto=format&fit=crop&w=1000&q=86",
  "https://images.unsplash.com/photo-1572251328767-e59f06f13ba1?auto=format&fit=crop&w=1000&q=86",
  "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1000&q=86",
]

type TrendRow = { id: string; name: string; subtitle: string | null; image_url: string | null }

export function trendRoutes(deps: Deps) {
  const { db, storage } = deps
  const app = new Hono<AuthEnv>()

  const active = (city: string) => db.sql<TrendRow[]>`
    select id, name, subtitle, image_url from trends
    where lower(city) = lower(${city}) and current_date between active_from and coalesce(active_to, current_date)
    order by rank`

  async function generate(city: string) {
    return db.asService(async (tx) => {
      // one generation per city at a time; re-check after taking the lock
      await tx`select pg_advisory_xact_lock(hashtext(${"trends:" + city.toLowerCase()}))`
      const existing = await active(city)
      if (existing.length) return
      const month = new Date().toLocaleString("en-US", { month: "long" })
      const { trends } = await deps.stylist.cityTrends({ city, month })
      const rows = trends.slice(0, 6).map((t, i) => ({
        city,
        name: t.name,
        subtitle: t.subtitle,
        image_url: STOCK[i % STOCK.length],
        rank: i + 1,
        active_to: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
        prompt: t.visualPrompt,
      }))
      const inserted = await tx<{ id: string }[]>`
        insert into trends ${tx(rows, "city", "name", "subtitle", "image_url", "rank", "active_to")} returning id`
      if (deps.images.enabled) {
        inserted.forEach((r, i) => queueTrendImage(deps, r.id, rows[i].prompt || rows[i].name))
      }
    })
  }

  app.get("/", async (c) => {
    const user = c.get("user")
    const q = parseQuery(c, z.object({ location: z.string().trim().min(1).max(120).optional() }))
    const place = q.location ?? (await db.asUser(user.id, user.claims, (tx) => profile(tx, user.id)))?.city
    if (!place) throw new HttpError(400, "Pass ?location= or set a city on your profile")
    // "Hauz Khas, New Delhi" -> "New Delhi"
    const city = place.split(",").pop()!.trim()

    let rows = await active(city)
    if (!rows.length) {
      try {
        await generate(city)
      } catch (err) {
        console.error("[trends]", err)
        throw new HttpError(502, "Trends are unavailable right now")
      }
      rows = await active(city)
    }
    const urls = await storage.urls("looks", rows.map((r) => r.image_url))
    return c.json(
      rows.map((r) => ({ id: r.id, name: r.name, subtitle: r.subtitle ?? "", imageUrl: (r.image_url && urls.get(r.image_url)) || "" })),
    )
  })

  return app
}

function queueTrendImage(deps: Deps, trendId: string, prompt: string) {
  deps.jobs.run(`trend ${trendId}`, async () => {
    const image = await deps.images.generate({ prompt: editorial(prompt) })
    if (!image) return
    const path = `trends/${trendId}.webp`
    await deps.storage.upload("looks", path, image.bytes, image.contentType)
    await deps.db.asService((tx) => tx`update trends set image_url = ${path} where id = ${trendId}`)
  })
}
