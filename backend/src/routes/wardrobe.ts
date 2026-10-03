// /api/wardrobe: summary tiles, item grid, scan (AI tagging), add, edit, delete
import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { z } from "zod"
import { CATEGORIES } from "../ai/types.js"
import type { AuthEnv } from "../auth.js"
import type { Deps } from "../deps.js"
import { HttpError, parseBody, parseQuery, readImageUpload, idParam } from "../http.js"
import { itemsToApi, wardrobeItems, type ItemRow } from "../queries.js"

const SUMMARY_LABELS = ["Tops", "Outerwear", "Bottoms", "Shoes & more"]

const ItemFields = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES),
  subcategory: z.string().trim().max(60).nullish(),
  color: z.string().trim().max(40).nullish(),
  pattern: z.string().trim().max(40).nullish(),
  material: z.string().trim().max(60).nullish(),
  style: z.string().trim().max(60).nullish(),
  season: z.string().trim().max(40).optional(),
})

const NewItem = ItemFields.extend({
  imagePath: z.string().min(1),
  cutoutPath: z.string().nullish(),
  aiAttributes: z.record(z.string(), z.unknown()).optional(),
}).strict()

const EditItem = ItemFields.extend({ favorite: z.boolean() }).partial().strict()

export function wardrobeRoutes(deps: Deps) {
  const { db, storage } = deps
  const app = new Hono<AuthEnv>()

  app.get("/summary", async (c) => {
    const user = c.get("user")
    const rows = await db.asUser(user.id, user.claims, (tx) =>
      tx`select label, count::int, image_path from category_summary where user_id = ${user.id}`,
    )
    const urls = await storage.urls("wardrobe", rows.map((r) => r.image_path))
    // always four tiles in the home screen's order, empty categories show 0
    return c.json(
      SUMMARY_LABELS.map((label) => {
        const row = rows.find((r) => r.label === label)
        return { label, count: row?.count ?? 0, imageUrl: (row && urls.get(row.image_path)) || "" }
      }),
    )
  })

  app.get("/items", async (c) => {
    const user = c.get("user")
    // "All items" (the first chip) or no value means no filter
    const q = parseQuery(c, z.object({ category: z.union([z.enum(CATEGORIES), z.literal("All items")]).optional() }))
    const category = q.category === "All items" ? undefined : q.category
    const rows = await db.asUser(user.id, user.claims, (tx) => wardrobeItems(tx, user.id, category))
    return c.json(await itemsToApi(storage, rows))
  })

  // Upload a photo, tag it with the vision model and cut out the background. Nothing is saved
  // to the wardrobe yet; the client confirms with POST /items using the returned `item`.
  app.post("/scan", async (c) => {
    const user = c.get("user")
    const started = Date.now()
    const img = await readImageUpload(c, 10 * 1024 * 1024)
    const id = randomUUID()
    const imagePath = `${user.id}/${id}.${img.ext}`
    await storage.upload("wardrobe", imagePath, img.bytes, img.mediaType)

    const imageUrl = (await storage.urls("wardrobe", [imagePath])).get(imagePath)!
    const [scan, cutout] = await Promise.all([
      deps.stylist.scanItem({ data: Buffer.from(img.bytes).toString("base64"), mediaType: img.mediaType }),
      deps.images.removeBackground(imageUrl).catch((err) => {
        console.error("[scan] background removal failed", err)
        return null
      }),
    ])
    if (!scan.isClothing) throw new HttpError(422, "That photo doesn't look like a clothing item")

    let cutoutPath: string | null = null
    if (cutout) {
      cutoutPath = `${user.id}/${id}-cutout.png`
      await storage.upload("wardrobe", cutoutPath, cutout.bytes, cutout.contentType)
    }
    const shown = cutoutPath ?? imagePath
    const shownUrl = (await storage.urls("wardrobe", [shown])).get(shown)!
    const { isClothing: _, ...attrs } = scan
    return c.json({
      // ItemScan
      imageUrl: shownUrl,
      durationSec: Math.round((Date.now() - started) / 100) / 10,
      attributes: [
        ["Category", [attrs.category.replace(/s$/, ""), attrs.subcategory].filter(Boolean).join(" · ")],
        ["Color", attrs.color],
        ["Pattern", attrs.pattern],
        ["Material", attrs.material],
        ["Style", attrs.style],
        ["Season", attrs.season],
      ],
      // send this back to POST /api/wardrobe/items to save
      item: { ...attrs, imagePath, cutoutPath, aiAttributes: scan },
    })
  })

  app.post("/items", async (c) => {
    const user = c.get("user")
    const body = await parseBody(c, NewItem)
    for (const p of [body.imagePath, body.cutoutPath]) {
      if (p && !p.startsWith(`${user.id}/`)) throw new HttpError(400, "Image must come from your own scan")
    }
    const rows = await db.asUser(user.id, user.claims, async (tx) => {
      const [row] = await tx<ItemRow[]>`
        insert into wardrobe_items (user_id, name, category, subcategory, color, pattern, material, style, season,
                                    image_path, cutout_path, ai_attributes)
        values (${user.id}, ${body.name}, ${body.category}, ${body.subcategory ?? null}, ${body.color ?? null},
                ${body.pattern ?? null}, ${body.material ?? null}, ${body.style ?? null}, ${body.season ?? "All season"},
                ${body.imagePath}, ${body.cutoutPath ?? null}, ${tx.json((body.aiAttributes ?? {}) as never)})
        returning id`
      return tx<ItemRow[]>`select * from wardrobe_items_view where id = ${row.id}`
    })
    return c.json((await itemsToApi(storage, rows))[0], 201)
  })

  app.patch("/items/:id", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    const body = await parseBody(c, EditItem)
    const rows = await db.asUser(user.id, user.claims, async (tx) => {
      const set = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
      if (Object.keys(set).length) {
        const updated = await tx`update wardrobe_items set ${tx(set)} where id = ${id} returning id`
        if (!updated.length) throw new HttpError(404, "Item not found")
      }
      return tx<ItemRow[]>`select * from wardrobe_items_view where user_id = ${user.id} and id = ${id}`
    })
    if (!rows.length) throw new HttpError(404, "Item not found")
    return c.json((await itemsToApi(storage, rows))[0])
  })

  app.delete("/items/:id", async (c) => {
    const user = c.get("user")
    const id = idParam(c)
    const deleted = await db.asUser(user.id, user.claims, (tx) => tx`delete from wardrobe_items where id = ${id} returning id`)
    if (!deleted.length) throw new HttpError(404, "Item not found")
    return c.body(null, 204)
  })

  return app
}
