// /api/looks: generate (Style AI), poll, swap an item, save, wear, today's pick, saved list
import { Hono } from "hono"
import { z } from "zod"
import type { AuthEnv } from "../auth.js"
import type { Tx } from "../db.js"
import type { Deps } from "../deps.js"
import { HttpError, idParam, parseBody, parseQuery } from "../http.js"
import {
  itemsForAI,
  itemImage,
  itemsToApi,
  studioPath,
  lookToApi,
  profile,
  profileForAI,
  wardrobeItems,
  type ItemRow,
  type LookRow,
  type ProfileRow,
} from "../queries.js"
import { tryOnPrompt, type BodyProfile } from "../tryon.js"
import type { Weather } from "../weather.js"

// Body of "Create my look" / "Try another": the generator's five fields (LookRequest)
const LookRequest = z.object({
  occasion: z.string().trim().min(1).max(60),
  style: z.string().trim().min(1).max(60),
  location: z.string().trim().max(120).default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  time: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")).default(""),
  // IANA zone the date/time were entered in
  timezone: z.string().default("Asia/Kolkata"),
})

const Swap = z.object({ wardrobeItemId: z.guid(), replacementId: z.guid().optional() }).strict()

/** "2025-10-18" + "18:30" in Asia/Kolkata -> Date */
export function zonedDate(date: string, time: string, timeZone: string): Date | null {
  if (!date) return null
  const [y, m, d] = date.split("-").map(Number)
  const [hh, mm] = (time || "12:00").split(":").map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  let guess = wall
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      })
        .formatToParts(new Date(guess))
        .map((p) => [p.type, Number(p.value)]),
    )
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    guess += wall - shown
  }
  return new Date(guess)
}

export function lookRoutes(deps: Deps) {
  const { db, storage, stylist } = deps
  const app = new Hono<AuthEnv>()

  const loadLook = async (tx: Tx, id: string) => {
    const [look] = await tx<LookRow[]>`select * from looks where id = ${id}`
    if (!look) throw new HttpError(404, "Look not found")
    return look
  }

  app.post("/generate", async (c) => {
    const user = c.get("user")
    let body: z.infer<typeof LookRequest>
    try {
      body = await parseBody(c, LookRequest)
      new Intl.DateTimeFormat("en", { timeZone: body.timezone })
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(400, "Unknown timezone")
    }
    const when = zonedDate(body.date, body.time, body.timezone)

    const ctx = await db.asUser(user.id, user.claims, async (tx) => {
      const p = await profile(tx, user.id)
      const items = await wardrobeItems(tx, user.id)
      // earlier combinations for the same occasion, so "Try another" gives something new
      const recent = await tx<{ ids: string[] }[]>`
        select array_agg(li.wardrobe_item_id::text order by li.position) as ids
        from looks l join look_items li on li.look_id = l.id
        where l.user_id = ${user.id} and l.occasion = ${body.occasion} and l.created_at > now() - interval '1 day'
        group by l.id order by max(l.created_at) desc limit 5`
      return { profile: p, items, avoid: recent.map((r) => r.ids) }
    })
    if (ctx.items.length < 2) throw new HttpError(400, "Add a few items to your wardrobe first")

    const place = body.location || ctx.profile.city || ""
    const city = place.split(",").pop()?.trim() ?? ""
    const [weather, trends] = await Promise.all([
      place ? deps.weather.get(place, when ?? undefined).catch(() => null) : Promise.resolve(null as Weather | null),
      city
        ? db.asUser(user.id, user.claims, (tx) => tx`select name from trends where lower(city) = lower(${city})
            and current_date between active_from and coalesce(active_to, current_date) order by rank limit 6`)
        : Promise.resolve([]),
    ])

    const [look] = await db.asUser(user.id, user.claims, (tx) => tx<LookRow[]>`
      insert into looks (user_id, occasion, style, location, event_at, weather)
      values (${user.id}, ${body.occasion}, ${body.style}, ${body.location || null}, ${when}, ${weather ? tx.json(weather) : null})
      returning *`)

    let result
    try {
      result = await stylist.generateLook({
        occasion: body.occasion,
        style: body.style,
        location: place || null,
        when,
        weather,
        wardrobe: itemsForAI(ctx.items),
        profile: profileForAI(ctx.profile),
        trends: trends.map((t) => t.name as string),
        avoid: ctx.avoid,
      })
    } catch (err) {
      await db.asUser(user.id, user.claims, (tx) =>
        tx`update looks set status = 'failed', visualization_status = 'failed', error = ${(err as Error).message} where id = ${look.id}`,
      )
      throw new HttpError(502, "The stylist couldn't create a look right now. Try again.")
    }

    // keep only real, distinct item ids from this wardrobe
    const owned = new Set(ctx.items.map((i) => i.id))
    const ids = [...new Set(result.itemIds)].filter((id) => owned.has(id))
    if (!ids.length) {
      await db.asUser(user.id, user.claims, (tx) =>
        tx`update looks set status = 'failed', visualization_status = 'failed', error = 'no valid items' where id = ${look.id}`,
      )
      throw new HttpError(502, "The stylist couldn't build a look from your wardrobe. Try another occasion or style.")
    }

    const out = await db.asUser(user.id, user.claims, async (tx) => {
      await tx`update looks set title = ${result.title}, reasoning = ${result.reasoning}, tags = ${result.tags.slice(0, 4)},
                 style_match = ${Math.max(0, Math.min(100, Math.round(result.styleMatch)))}, status = 'ready'
               where id = ${look.id}`
      await tx`select set_look_items(${look.id}, ${ids}::uuid[])`
      return lookToApi(tx, storage, await loadLook(tx, look.id))
    })

    queueVisualization(deps, user.id, look.id, result.visualPrompt)
    return c.json(out, 201)
  })

  app.get("/today", async (c) => {
    const user = c.get("user")
    const look = await db.asUser(user.id, user.claims, async (tx) => {
      const [row] = await tx<LookRow[]>`
        (select * from looks where user_id = ${user.id} and status = 'ready' and event_at::date = current_date
          order by created_at desc limit 1)
        union all
        (select * from looks where user_id = ${user.id} and status = 'ready' and saved_at is not null
          order by saved_at desc limit 1)
        limit 1`
      return row ? lookToApi(tx, storage, row) : null
    })
    // Home "Today's pick" card; null when there is nothing to show yet
    return c.json(look && { id: look.id, title: look.title, imageUrl: look.visualizationUrl })
  })

  app.get("/", async (c) => {
    const user = c.get("user")
    const q = parseQuery(c, z.object({ saved: z.enum(["true", "false"]).optional() }))
    const looks = await db.asUser(user.id, user.claims, async (tx) => {
      const rows = await tx<LookRow[]>`
        select * from looks where user_id = ${user.id} and status = 'ready'
        ${q.saved === "true" ? tx`and saved_at is not null` : tx``}
        order by coalesce(saved_at, created_at) desc limit 50`
      return Promise.all(rows.map((r) => lookToApi(tx, storage, r)))
    })
    return c.json(looks)
  })

  // Poll this after generate until visualizationStatus is no longer "pending"
  app.get("/:id", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    return c.json(await db.asUser(user.id, user.claims, async (tx) => lookToApi(tx, storage, await loadLook(tx, id))))
  })

  // "Change item": without replacementId returns alternatives from the same category;
  // with it, swaps the item and returns the updated look.
  app.post("/:id/swap", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    const body = await parseBody(c, Swap)
    const res = await db.asUser(user.id, user.claims, async (tx) => {
      const look = await loadLook(tx, id)
      const current = (await tx`select wardrobe_item_id from look_items where look_id = ${id} order by position`).map(
        (r) => r.wardrobe_item_id as string,
      )
      if (!current.includes(body.wardrobeItemId)) throw new HttpError(400, "That item isn't in this look")
      const [old] = await tx<ItemRow[]>`select * from wardrobe_items where id = ${body.wardrobeItemId}`

      if (!body.replacementId) {
        const alts = await tx<ItemRow[]>`
          select * from wardrobe_items_view
          where user_id = ${user.id} and category = ${old.category} and not (id = any(${current}::uuid[]))
          order by favorite desc, wear_count desc, created_at desc limit 12`
        return { alternatives: await itemsToApi(storage, alts) }
      }

      const [rep] = await tx<ItemRow[]>`select * from wardrobe_items where id = ${body.replacementId}`
      if (!rep) throw new HttpError(404, "Replacement item not found")
      if (current.includes(rep.id)) throw new HttpError(400, "That item is already in this look")
      const next = current.map((x) => (x === old.id ? rep.id : x))
      await tx`select set_look_items(${id}, ${next}::uuid[])`
      // the old visualization no longer matches the outfit
      await tx`update looks set visualization_path = null, visualization_status = 'pending' where id = ${id}`
      return { look: await lookToApi(tx, storage, { ...look, visualization_path: null, visualization_status: "pending" }) }
    })
    if (res.look) {
      queueVisualization(deps, user.id, id)
      return c.json(res.look)
    }
    return c.json(res)
  })

  for (const [method, saved] of [["post", true], ["delete", false]] as const) {
    app[method]("/:id/save", async (c) => {
      const user = c.get("user")
      const id = idParam(c)
      const rows = await db.asUser(user.id, user.claims, (tx) =>
        tx`update looks set saved_at = ${saved ? tx`now()` : null} where id = ${id} returning id`,
      )
      if (!rows.length) throw new HttpError(404, "Look not found")
      return c.json({ saved })
    })
  }

  // "Wear This": logs the outfit for today and bumps each item's wear count (once per day)
  app.post("/:id/wear", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    const [{ logged }] = await db.asUser(user.id, user.claims, (tx) => tx`select wear_look(${id}) as logged`)
    return c.json({ logged })
  })

  // "See it on me" / retry: regenerate the visualization
  app.post("/:id/visualize", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    const look = await db.asUser(user.id, user.claims, async (tx) => {
      await loadLook(tx, id)
      await tx`update looks set visualization_status = 'pending', error = null where id = ${id}`
      return lookToApi(tx, storage, await loadLook(tx, id))
    })
    queueVisualization(deps, user.id, id)
    return c.json(look, 202)
  })

  return app
}

function queueVisualization(deps: Deps, userId: string, lookId: string, scene?: string) {
  deps.jobs.run(`visualize ${lookId}`, async () => {
    try {
      const ctx = await deps.db.asService(async (tx) => {
        const [look] = await tx<LookRow[]>`select * from looks where id = ${lookId}`
        const items = await tx<ItemRow[]>`
          select wi.* from look_items li join wardrobe_items wi on wi.id = li.wardrobe_item_id
          where li.look_id = ${lookId} order by li.position`
        const [p] = await tx<ProfileRow[]>`select * from profiles where id = ${userId}`
        return { look, items, body: (p?.body_profile ?? {}) as BodyProfile }
      })
      if (!ctx.look) return
      const prompt = tryOnPrompt({ ...ctx, scene })
      // only models that take reference photos need the pieces and the face
      const fetchRefs = deps.images.usesReferences
      const [garments, face] = fetchRefs
        ? await Promise.all([
            // the studio photo shows the whole garment cleanly; otherwise the cleaned-up or original photo
            Promise.all(ctx.items.map((i) => deps.storage.download("wardrobe", studioPath(i) ?? itemImage(i)))),
            ctx.body.facePath ? deps.storage.download("avatars", ctx.body.facePath).catch(() => null) : null,
          ])
        : [undefined, null]
      const image = await deps.images.generate({ prompt, garments, face })
      if (!image) {
        await deps.db.asService((tx) =>
          tx`update looks set visualization_status = 'failed', error = 'image generation not configured' where id = ${lookId}`,
        )
        return
      }
      const ext = image.contentType.includes("png") ? "png" : image.contentType.includes("jpeg") ? "jpg" : "webp"
      const path = `${userId}/looks/${lookId}-${Date.now()}.${ext}`
      await deps.storage.upload("looks", path, image.bytes, image.contentType)
      await deps.db.asService((tx) =>
        tx`update looks set visualization_path = ${path}, visualization_status = 'ready', error = null where id = ${lookId}`,
      )
    } catch (err) {
      await deps.db.asService((tx) =>
        tx`update looks set visualization_status = 'failed', error = ${(err as Error).message} where id = ${lookId}`,
      )
      throw err
    }
  })
}
