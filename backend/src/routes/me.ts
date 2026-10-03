// GET/PATCH /api/me, POST /api/me/avatar, GET /api/me/stats, GET /api/weather
import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { z } from "zod"
import type { AuthEnv } from "../auth.js"
import type { Tx } from "../db.js"
import type { Deps } from "../deps.js"
import { HttpError, parseBody, parseQuery, readImageUpload } from "../http.js"
import { profile, type ProfileRow } from "../queries.js"

const PatchMe = z
  .object({
    name: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(80),
    styleDna: z.string().trim().max(200),
    styleTags: z.array(z.string().trim().min(1).max(40)).max(12),
    bodyProfile: z.record(z.string(), z.unknown()),
    stylePrefs: z.record(z.string(), z.unknown()),
  })
  .partial()
  .strict()

// Share of profile fields filled in, shown as "92% complete" on Profile
function completion(p: ProfileRow, wardrobeCount: number) {
  const checks = [
    !!p.name,
    !!p.city,
    !!p.avatar_path,
    !!p.style_dna,
    p.style_tags.length > 0,
    Object.keys(p.body_profile).length > 0,
    Object.keys(p.style_prefs).length > 0,
    wardrobeCount >= 10,
  ]
  return Math.round((100 * checks.filter(Boolean).length) / checks.length)
}

export function meRoutes(deps: Deps) {
  const { db, storage } = deps
  const app = new Hono<AuthEnv>()

  const toApi = async (p: ProfileRow, email?: string) => {
    const urls = await storage.urls("avatars", [p.avatar_path])
    return {
      name: p.name,
      city: p.city ?? "",
      avatarUrl: (p.avatar_path && urls.get(p.avatar_path)) || "",
      profileCompletion: p.profile_completion,
      styleDna: p.style_dna ?? "",
      styleTags: p.style_tags,
      // extras for the settings rows
      email: email ?? null,
      bodyProfile: p.body_profile,
      stylePrefs: p.style_prefs,
    }
  }

  app.get("/me", async (c) => {
    const user = c.get("user")
    const p = await db.asUser(user.id, user.claims, (tx) => profile(tx, user.id))
    if (!p) throw new HttpError(404, "Profile not found")
    return c.json(await toApi(p, user.email))
  })

  app.patch("/me", async (c) => {
    const user = c.get("user")
    const body = await parseBody(c, PatchMe)
    const p = await db.asUser(user.id, user.claims, async (tx) => {
      const cols = {
        name: body.name,
        city: body.city,
        style_dna: body.styleDna,
        style_tags: body.styleTags,
        body_profile: body.bodyProfile && tx.json(body.bodyProfile as never),
        style_prefs: body.stylePrefs && tx.json(body.stylePrefs as never),
      }
      const set = Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined))
      if (Object.keys(set).length) await tx`update profiles set ${tx(set)} where id = ${user.id}`
      return refreshCompletion(tx, user.id)
    })
    return c.json(await toApi(p, user.email))
  })

  app.post("/me/avatar", async (c) => {
    const user = c.get("user")
    const img = await readImageUpload(c, 5 * 1024 * 1024)
    const path = `${user.id}/${randomUUID()}.${img.ext}`
    await storage.upload("avatars", path, img.bytes, img.mediaType)
    const p = await db.asUser(user.id, user.claims, async (tx) => {
      await tx`update profiles set avatar_path = ${path} where id = ${user.id}`
      return refreshCompletion(tx, user.id)
    })
    return c.json(await toApi(p, user.email))
  })

  app.get("/me/stats", async (c) => {
    const user = c.get("user")
    const [s] = await db.asUser(user.id, user.claims, (tx) => tx`select * from user_stats where user_id = ${user.id}`)
    return c.json({
      wardrobeCount: s?.wardrobe_count ?? 0,
      savedLooks: s?.saved_looks ?? 0,
      daysStyled: s?.days_styled ?? 0,
    })
  })

  app.get("/weather", async (c) => {
    const user = c.get("user")
    const q = parseQuery(c, z.object({ location: z.string().trim().min(1).max(120).optional() }))
    const location = q.location ?? (await db.asUser(user.id, user.claims, (tx) => profile(tx, user.id)))?.city
    if (!location) throw new HttpError(400, "Pass ?location= or set a city on your profile")
    try {
      return c.json({ ...(await deps.weather.get(location)), location })
    } catch (err) {
      throw new HttpError(502, `Weather unavailable: ${(err as Error).message}`)
    }
  })

  return app
}

async function refreshCompletion(tx: Tx, userId: string) {
  const p = await profile(tx, userId)
  const [{ n }] = await tx`select count(*)::int as n from wardrobe_items where user_id = ${userId}`
  const pct = completion(p, n)
  await tx`update profiles set profile_completion = ${pct} where id = ${userId}`
  return { ...p, profile_completion: pct }
}
