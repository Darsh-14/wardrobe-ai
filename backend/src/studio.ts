// Studio photos: the user's own photo of an item redone as a clean catalogue picture (on an
// invisible mannequin, a trouser hanger, a dress form or a plinth): the same garment, with any part
// that was cut off or hidden filled in. The Wardrobe shows these, with the original one tap away.
// Stored in ai_attributes.studio_path.
import type { Deps } from "./deps.js"
import type { ItemRow } from "./queries.js"

const BACKDROP = "soft light grey-blue seamless studio backdrop, gentle shadow, e-commerce catalogue photo, centred, high detail, no person, no text"

/** Prompt for redoing the photo (image 0) of this item as a studio shot */
export function studioEditPrompt(i: Pick<ItemRow, "category" | "name" | "color" | "material" | "pattern" | "subcategory">) {
  const display = {
    Tops: "on an invisible ghost mannequin showing its natural 3D shape, front view",
    Outerwear: "on an invisible ghost mannequin showing its natural 3D shape, front view",
    Dresses: "on a tailor's dress form mannequin with a wooden neck cap",
    Bottoms: "neatly folded over a wooden trouser hanger, hanging straight, front view",
    Shoes: "as a pair, three-quarter view on a low white plinth",
    Accessories: "on a small white plinth",
  }[i.category]
  return [
    `Image 0 is a phone photo of the user's ${i.name}.`,
    `Recreate exactly this same ${i.subcategory || i.name} as a professional e-commerce product photo, ${display}.`,
    "Keep it identical to the photo: the same colour and shade, wash and fading, fabric texture, print, stitching, buttons, pockets, labels, length and fit.",
    "Show the whole garment, neat and uncreased. Where part of it is cut off, folded or hidden in the photo, complete it so it matches the visible part.",
    `Remove the person, bed, furniture and everything else; ${BACKDROP}.`,
  ].join(" ")
}

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
export function ensureStudioPhotos(deps: Deps, userId: string, rows: ItemRow[], opts: { retry?: boolean } = {}) {
  if (!deps.images.enabled) return
  for (const row of rows) {
    if (opts.retry) failedAt.delete(row.id)
    if (row.ai_attributes?.studio_path || pending.has(row.id)) continue
    if (Date.now() - (failedAt.get(row.id) ?? 0) < 60 * 60 * 1000) continue
    pending.add(row.id)
    deps.jobs.run(`studio ${row.id}`, async () => {
      try {
        // from the user's own photo when the provider can edit from it, so it's the same garment
        const photo = deps.images.usesReferences ? await deps.storage.download("wardrobe", row.image_path) : null
        const image = await deps.images.generate(
          photo
            ? { prompt: studioEditPrompt(row), garments: [photo], mode: "studio", width: 832, height: 1040 }
            : { prompt: studioPrompt(row) },
        )
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
