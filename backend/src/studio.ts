// Studio photos: a clean catalogue picture of each wardrobe item (on an invisible mannequin, a
// trouser hanger, a dress form or a plinth), drawn from the scan's description. The Wardrobe shows
// these, with the user's own photo one tap away. Stored in ai_attributes.studio_path.
import type { Deps } from "./deps.js"
import type { ItemRow } from "./queries.js"

const BACKDROP = "soft light grey-blue seamless studio backdrop, gentle shadow, e-commerce catalogue photo, centred, high detail, no person, no text"

export function studioPrompt(i: Pick<ItemRow, "category" | "name" | "color" | "material" | "pattern" | "subcategory">) {
  const pattern = i.pattern && !/^(solid|plain|none)$/i.test(i.pattern) ? `${i.pattern.toLowerCase()} ` : ""
  const what = `${[i.color, i.material].filter(Boolean).join(" ")} ${pattern}${i.subcategory || i.name}`.replace(/\s+/g, " ").trim()
  switch (i.category) {
    case "Tops":
    case "Outerwear":
      return `Ghost mannequin product photo of a ${what} (${i.name}), invisible mannequin showing its natural shape, front view, ${BACKDROP}`
    case "Dresses":
      return `Product photo of a ${what} (${i.name}) on a tailor's dress form mannequin with a wooden neck cap, cream wall, ${BACKDROP}`
    case "Bottoms":
      return `Product photo of ${what} (${i.name}) neatly folded over a wooden trouser hanger, hanging, front view, ${BACKDROP}`
    case "Shoes":
      return `Product photo of a pair of ${what} (${i.name}), three-quarter view on a low white plinth, ${BACKDROP}`
    default:
      return `Product photo of a ${what} (${i.name}) displayed on a small white plinth, ${BACKDROP}`
  }
}

const pending = new Set<string>()
const failedAt = new Map<string, number>()

/** Queues studio photos for items that don't have one yet (each at most once an hour if it fails). */
export function ensureStudioPhotos(deps: Deps, userId: string, rows: ItemRow[]) {
  if (!deps.images.enabled) return
  for (const row of rows) {
    if (row.ai_attributes?.studio_path || pending.has(row.id)) continue
    if (Date.now() - (failedAt.get(row.id) ?? 0) < 60 * 60 * 1000) continue
    pending.add(row.id)
    deps.jobs.run(`studio ${row.id}`, async () => {
      try {
        const image = await deps.images.generate({ prompt: studioPrompt(row) })
        if (!image) return
        const path = `${userId}/${row.id}-studio-${Date.now()}.jpg`
        await deps.storage.upload("wardrobe", path, image.bytes, image.contentType)
        await deps.db.asService((tx) =>
          tx`update wardrobe_items set ai_attributes = ai_attributes || ${tx.json({ studio_path: path })} where id = ${row.id}`,
        )
      } catch (err) {
        failedAt.set(row.id, Date.now())
        throw err
      } finally {
        pending.delete(row.id)
      }
    })
  }
}
