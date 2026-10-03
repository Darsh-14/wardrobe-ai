// /api/recommendations (For You) and /api/shopping (Ask my stylist)
import { Hono } from "hono"
import { z } from "zod"
import type { AuthEnv } from "../auth.js"
import type { Tx } from "../db.js"
import type { Deps } from "../deps.js"
import { HttpError, idParam, parseBody } from "../http.js"
import { formatPrice, itemImage, itemsForAI, profile, profileForAI, wardrobeItems, type ItemRow } from "../queries.js"

type RecRow = {
  id: string
  owned_item_id: string | null
  product_name: string
  product_image_url: string | null
  price_amount: number | null
  price_currency: string
  description: string | null
  style_match: number | null
  new_looks: number
  visualization_path: string | null
}

type ShoppingRow = {
  id: string
  prompt: string
  owned_item_ids: string[]
  gap_title: string | null
  gap_description: string | null
  visualization_path: string | null
  status: "pending" | "ready" | "failed"
}

function rethrowAs502(err: unknown): never {
  if (err instanceof HttpError) throw err
  console.error("[recommendations]", err)
  throw new HttpError(502, "The stylist couldn't make a recommendation right now")
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))

export function stylistRoutes(deps: Deps) {
  const { db, storage, stylist } = deps
  const recs = new Hono<AuthEnv>()
  const shopping = new Hono<AuthEnv>()

  async function recToApi(tx: Tx, r: RecRow) {
    const [owned] = r.owned_item_id ? await tx<ItemRow[]>`select * from wardrobe_items where id = ${r.owned_item_id}` : []
    const ownedPath = owned ? itemImage(owned) : null
    const w = await storage.urls("wardrobe", [ownedPath])
    const l = await storage.urls("looks", [r.product_image_url, r.visualization_path])
    const ownedUrl = (ownedPath && w.get(ownedPath)) || ""
    return {
      id: r.id,
      ownedItemName: owned ? `The ${owned.name.toLowerCase()}` : "",
      ownedItemImageUrl: ownedUrl,
      suggestedImageUrl: (r.product_image_url && l.get(r.product_image_url)) || (r.visualization_path && l.get(r.visualization_path)) || ownedUrl,
      description: r.description ?? "",
      estimatedPrice: formatPrice(r.price_amount, r.price_currency),
      styleMatch: r.style_match ?? 0,
      newLooks: r.new_looks,
      visualizationUrl: (r.visualization_path && l.get(r.visualization_path)) || ownedUrl,
      productName: r.product_name,
    }
  }

  async function generateRecommendation(userId: string, claims: Record<string, unknown>) {
    const ctx = await db.asUser(userId, claims, async (tx) => ({
      profile: await profile(tx, userId),
      items: await wardrobeItems(tx, userId),
    }))
    if (ctx.items.length < 3) throw new HttpError(409, "Add a few more items to get recommendations")
    const r = await stylist.recommend({ wardrobe: itemsForAI(ctx.items), profile: profileForAI(ctx.profile) })
    const owned = ctx.items.find((i) => i.id === r.ownedItemId) ?? ctx.items[0]
    // recommendations are AI-written, so they are inserted with the service role
    const [row] = await db.asService((tx) => tx<{ id: string }[]>`
      insert into recommendations (user_id, owned_item_id, product_name, price_amount, price_currency, description,
                                   style_match, new_looks)
      values (${userId}, ${owned.id}, ${r.productName}, ${Math.round(r.estimatedPriceInr)}, 'INR', ${r.description},
              ${clamp(r.styleMatch, 0, 100)}, ${clamp(r.newLooks, 0, 99)})
      returning id`)
    deps.jobs.run(`recommendation ${row.id}`, async () => {
      const image = await deps.images.generate(r.visualPrompt)
      if (!image) return
      const path = `${userId}/recommendations/${row.id}.webp`
      await storage.upload("looks", path, image.bytes, image.contentType)
      await db.asService((tx) => tx`update recommendations set visualization_path = ${path} where id = ${row.id}`)
    })
    return row.id
  }

  const latest = (tx: Tx, userId: string) =>
    tx<RecRow[]>`select * from recommendations where user_id = ${userId} and dismissed_at is null
                 order by created_at desc limit 1`

  recs.get("/", async (c) => {
    const user = c.get("user")
    let [row] = await db.asUser(user.id, user.claims, (tx) => latest(tx, user.id))
    if (!row) {
      await generateRecommendation(user.id, user.claims).catch(rethrowAs502)
      ;[row] = await db.asUser(user.id, user.claims, (tx) => latest(tx, user.id))
    }
    return c.json(await db.asUser(user.id, user.claims, (tx) => recToApi(tx, row)))
  })

  recs.post("/refresh", async (c) => {
    const user = c.get("user")
    const id = await generateRecommendation(user.id, user.claims).catch(rethrowAs502)
    return c.json(
      await db.asUser(user.id, user.claims, async (tx) => {
        const [row] = await tx<RecRow[]>`select * from recommendations where id = ${id}`
        return recToApi(tx, row)
      }),
      201,
    )
  })

  recs.post("/:id/dismiss", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    const rows = await db.asUser(user.id, user.claims, (tx) =>
      tx`update recommendations set dismissed_at = now() where id = ${id} returning id`,
    )
    if (!rows.length) throw new HttpError(404, "Recommendation not found")
    return c.body(null, 204)
  })

  async function shoppingToApi(tx: Tx, s: ShoppingRow) {
    const owned = s.owned_item_ids.length
      ? await tx<ItemRow[]>`select * from wardrobe_items where id = any(${s.owned_item_ids}::uuid[])`
      : []
    const ordered = s.owned_item_ids.map((id) => owned.find((o) => o.id === id)).filter((o): o is ItemRow => !!o)
    const w = await storage.urls("wardrobe", ordered.map(itemImage))
    const l = await storage.urls("looks", [s.visualization_path])
    return {
      id: s.id,
      ownedItems: ordered.map((o) => o.name),
      gapTitle: s.gap_title ?? "",
      gapDescription: s.gap_description ?? "",
      visualizationUrl: (s.visualization_path && l.get(s.visualization_path)) || (ordered[0] && w.get(itemImage(ordered[0]))) || "",
      status: s.status,
    }
  }

  shopping.post("/ask", async (c) => {
    const user = c.get("user")
    const { prompt } = await parseBody(c, z.object({ prompt: z.string().trim().min(3).max(500) }))
    const ctx = await db.asUser(user.id, user.claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`insert into shopping_queries (user_id, prompt) values (${user.id}, ${prompt}) returning id`
      return { id: row.id, profile: await profile(tx, user.id), items: await wardrobeItems(tx, user.id) }
    })
    let r
    try {
      r = await stylist.shopping({ prompt, wardrobe: itemsForAI(ctx.items), profile: profileForAI(ctx.profile) })
    } catch (err) {
      console.error("[shopping]", err)
      await db.asUser(user.id, user.claims, (tx) => tx`update shopping_queries set status = 'failed' where id = ${ctx.id}`)
      throw new HttpError(502, "The stylist couldn't answer right now. Try again.")
    }
    const ownedIds = new Set(ctx.items.map((i) => i.id))
    const picked = [...new Set(r.ownedItemIds)].filter((id) => ownedIds.has(id)).slice(0, 3)
    const out = await db.asUser(user.id, user.claims, async (tx) => {
      const [row] = await tx<ShoppingRow[]>`
        update shopping_queries set owned_item_ids = ${picked}::uuid[], gap_title = ${r.gapTitle},
               gap_description = ${r.gapDescription}, status = 'ready'
        where id = ${ctx.id} returning *`
      return shoppingToApi(tx, row)
    })
    deps.jobs.run(`shopping ${ctx.id}`, async () => {
      const image = await deps.images.generate(r.visualPrompt)
      if (!image) return
      const path = `${user.id}/shopping/${ctx.id}.webp`
      await storage.upload("looks", path, image.bytes, image.contentType)
      await db.asService((tx) => tx`update shopping_queries set visualization_path = ${path} where id = ${ctx.id}`)
    })
    return c.json(out, 201)
  })

  shopping.get("/:id", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    const out = await db.asUser(user.id, user.claims, async (tx) => {
      const [row] = await tx<ShoppingRow[]>`select * from shopping_queries where id = ${id}`
      if (!row) throw new HttpError(404, "Not found")
      return shoppingToApi(tx, row)
    })
    return c.json(out)
  })

  return { recs, shopping }
}
