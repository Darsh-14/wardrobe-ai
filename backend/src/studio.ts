// Studio photos: the user's own photo of an item redone as a clean catalogue picture (on an
// invisible mannequin or a plinth, full and three-dimensional): the same garment, with any part
// that was cut off or hidden filled in. The Wardrobe shows these, with the original one tap away.
// Stored in ai_attributes.studio_path.
import type { Deps } from "./deps.js"
import type { ItemRow } from "./queries.js"

const BACKDROP = "soft light grey-blue seamless studio backdrop, e-commerce catalogue photo, centred, high detail, no person, no text"
// every item looks three-dimensional: full volume, side light for depth, a soft contact shadow underneath
const DEPTH = "three-dimensional with real volume and depth, soft directional studio light from the upper left with gentle shading on the far side, a soft contact shadow on the floor beneath it"

/** Prompt for redoing the photo (image 0) of this item as a studio shot */
export function studioEditPrompt(i: Pick<ItemRow, "category" | "name" | "color" | "material" | "pattern" | "subcategory">) {
  const display = {
    Tops: "on an invisible ghost mannequin, full and rounded as if worn, chest and shoulders filled out, sleeves rounded, collar and neck opening open with the inside back visible, slight three-quarter front view",
    Outerwear: "on an invisible ghost mannequin, full and rounded as if worn, shoulders and sleeves filled out, collar standing, the inside back visible through the open neck, slight three-quarter front view",
    Dresses: "on an invisible ghost mannequin, full and rounded as if worn, bodice filled out and the skirt falling in soft rounded folds, slight three-quarter front view",
    Bottoms: "on an invisible ghost mannequin, full and rounded as if worn, both legs straight and filled out, waistband open and round, front view",
    Shoes: "as a pair, filled out as if worn with laces tied, three-quarter view showing the side and the toe, on a low white plinth",
    Accessories: "standing in its natural shape, three-quarter view, on a small white plinth",
  }[i.category]
  return [
    `Image 0 is a phone photo of the user's ${i.name}.`,
    `Recreate exactly this same ${i.subcategory || i.name} as a professional e-commerce product photo, ${display}, ${DEPTH}.`,
    "Keep it identical to the photo: the same colour and shade, wash and fading, fabric texture, print, stitching, buttons, pockets, labels, length and fit.",
    "Show the whole garment, neat and uncreased, never flat or folded. Where part of it is cut off, folded or hidden in the photo, complete it so it matches the visible part.",
    `Remove the person, bed, furniture and everything else; ${BACKDROP}.`,
  ].join(" ")
}

export function studioPrompt(i: Pick<ItemRow, "category" | "name" | "color" | "material" | "pattern" | "subcategory">) {
  const pattern = i.pattern && !/^(solid|plain|none)$/i.test(i.pattern) ? `${i.pattern.toLowerCase()} ` : ""
  const what = `${[i.color, i.material].filter(Boolean).join(" ")} ${pattern}${i.subcategory || i.name}`.replace(/\s+/g, " ").trim()
  switch (i.category) {
    case "Tops":
    case "Outerwear":
      return `Ghost mannequin product photo of a ${what} (${i.name}), full and rounded as if worn, slight three-quarter front view, ${DEPTH}, ${BACKDROP}`
    case "Dresses":
      return `Product photo of a ${what} (${i.name}) on an invisible ghost mannequin, full and rounded as if worn, ${DEPTH}, ${BACKDROP}`
    case "Bottoms":
      return `Ghost mannequin product photo of ${what} (${i.name}), full and rounded as if worn, both legs straight, front view, ${DEPTH}, ${BACKDROP}`
    case "Shoes":
      return `Product photo of a pair of ${what} (${i.name}), filled out as if worn, three-quarter view on a low white plinth, ${DEPTH}, ${BACKDROP}`
    default:
      return `Product photo of a ${what} (${i.name}) standing in its natural shape on a small white plinth, three-quarter view, ${DEPTH}, ${BACKDROP}`
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
        const fromText = () => deps.images.generate({ prompt: studioPrompt(row) })
        // when editing from the photo fails, a picture drawn from the description beats none at all
        const image = photo
          ? await deps.images
              .generate({ prompt: studioEditPrompt(row), garments: [photo], mode: "studio", width: 832, height: 1040 })
              .catch((err: Error) => {
                console.warn(`[studio ${row.id}] editing from the photo failed, drawing from the description: ${err.message}`)
                return fromText()
              })
          : await fromText()
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
