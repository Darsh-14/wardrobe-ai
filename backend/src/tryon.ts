// "See it on you": the prompt for a picture of a model shaped like the user (Profile > Body & fit),
// wearing the look's pieces and posed at the place they're going.
import { shrinkImage } from "./ai/images.js"
import type { ImageAI, ImageBytes, StylistAI, TryOnCheck } from "./ai/types.js"
import type { ItemRow, LookRow } from "./queries.js"
import { timeOfDay } from "./queries.js"

/** profiles.body_profile, edited on Profile > Body & fit profile */
export type BodyProfile = {
  model?: string // "Woman" | "Man"
  heightCm?: number
  weightKg?: number
  build?: string // "Slim" | "Athletic" | "Average" | "Curvy" | "Plus size"
  skinTone?: string
  /** avatars bucket path of the optional face photo */
  facePath?: string | null
}

// Setting and pose for common occasions, used when the stylist gave no scene of its own
const SCENES: [RegExp, string, string][] = [
  [/office|work|meeting|interview|formal/i, "a bright, modern office lobby", "standing tall with one hand in a pocket"],
  [/wedding|festive|puja|diwali|sangeet|haldi|ceremony/i, "a decorated wedding venue with marigold garlands", "standing gracefully, hands relaxed"],
  [/party|club|night|concert/i, "a lively evening party with warm lights", "relaxed stance, mid-laugh"],
  [/date|dinner|brunch|lunch|cafe|restaurant/i, "a cosy restaurant with soft lighting", "standing by the table, smiling"],
  [/beach|vacation|holiday|trip|travel/i, "a sunny seaside promenade", "walking with a relaxed stride"],
  [/gym|workout|run|sport|yoga/i, "a clean, airy gym studio", "athletic stance, ready to move"],
  [/college|campus|class|school/i, "a leafy college campus", "standing with a bag on one shoulder"],
]

export function sceneFor(occasion: string, location: string | null) {
  const hit = SCENES.find(([re]) => re.test(occasion))
  const where = location ? ` in ${location}` : ""
  return hit ? { scene: `${hit[1]}${where}`, pose: hit[2] } : { scene: location ? `a street${where}` : "a city street", pose: "walking naturally, relaxed" }
}

export function describePerson(body: BodyProfile) {
  const who = /^w|female/i.test(body.model ?? "") ? "adult woman" : /^m/i.test(body.model ?? "") ? "adult man" : "adult person"
  const size = [body.heightCm && `about ${body.heightCm} cm tall`, body.weightKg && `about ${body.weightKg} kg`].filter(Boolean).join(" and ")
  const build = body.build ? `${body.build.toLowerCase()} build` : ""
  const skin = body.skinTone ? `${body.skinTone.toLowerCase()} skin tone` : ""
  const traits = [build, skin].filter(Boolean).join(" and ")
  return [`one ${who}`, size, traits && `with ${/^[aeiou]/i.test(traits) ? "an" : "a"} ${traits}`].filter(Boolean).join(", ")
}

// what each piece is on the body, so the picture model knows which photo goes where
const ROLES: Record<string, string> = {
  Outerwear: "outer layer",
  Tops: "top",
  Dresses: "dress",
  Bottoms: "bottoms",
  Shoes: "shoes",
  Accessories: "accessory",
}

const describe = (i: Pick<ItemRow, "color" | "material" | "subcategory" | "name">) =>
  [i.color, i.material, i.subcategory || i.name].filter(Boolean).join(" ")

/** One label per item for the reference photos, e.g. "top: Yellow Cotton Kurta" */
export function garmentLabels(items: Pick<ItemRow, "category" | "color" | "material" | "subcategory" | "name">[]) {
  return items.map((i) => `${ROLES[i.category] ?? "garment"}: ${describe(i)}`)
}

/** How the pieces sit on the body, so none of them is hidden or left out */
function layering(items: ItemRow[]) {
  const find = (c: string) => items.find((i) => i.category === c)
  const top = find("Tops") ?? find("Dresses")
  const bottoms = find("Bottoms")
  const outer = find("Outerwear")
  const shoes = find("Shoes")
  return [
    top && bottoms
      ? `The ${describe(top)} is worn over the ${describe(bottoms)}, and the ${describe(bottoms)} are clearly visible below its hem all the way down to the ankles.`
      : "",
    outer ? `The ${describe(outer)} is worn open on top.` : "",
    shoes ? `The ${describe(shoes)} are visible on the feet.` : "",
  ].filter(Boolean).join(" ")
}

export function tryOnPrompt(input: { body: BodyProfile; look: LookRow; items: ItemRow[]; scene?: string }) {
  const { body, look, items } = input
  const pieces = items.map(describe).join("; ")
  const auto = sceneFor(look.occasion, look.location)
  const setting = input.scene?.trim() || `${auto.scene}, ${auto.pose}`
  const light = timeOfDay(look.event_at)
  const weather = look.weather?.condition ? `, ${look.weather.condition.toLowerCase()} weather` : ""
  return [
    `Photorealistic full-length fashion photo of ${describePerson(body)}.`,
    `Wearing: ${pieces}.`,
    layering(items),
    `Setting and pose: ${setting} (${look.occasion}).`,
    `${light === "Today" ? "Natural daylight" : `${light} light`}${weather}.`,
    // framing first: a model left to itself crops at the thighs and drops the trousers and shoes
    "Wide full-body shot from a few metres away: the whole person from the top of the head to the feet is in frame, with space above the head and below the shoes, every piece of the outfit fully visible.",
    "Shot on a full-frame camera with a 50 mm lens at eye level, sharp focus on the person, softly blurred background, natural skin texture, realistic fabric folds and drape, correct hands and anatomy, true-to-life colours, no text, no watermark.",
  ].filter(Boolean).join(" ")
}

const CHECKABLE = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const

/** Asks the stylist's vision model what the picture shows; null when it can't tell (busy, offline) */
async function lookAt(stylist: Pick<StylistAI, "checkTryOn">, image: ImageBytes, pieces: string[]): Promise<TryOnCheck | null> {
  try {
    const small = await shrinkImage(image, 768)
    const mediaType = CHECKABLE.find((t) => t === small.contentType)
    if (!mediaType) return null
    return await stylist.checkTryOn({ image: { data: Buffer.from(small.bytes).toString("base64"), mediaType }, pieces })
  } catch (err) {
    console.warn(`[tryon] couldn't check the picture: ${(err as Error).message}`)
    return null
  }
}

/**
 * Draws the try-on picture, checks it shows the whole person in every piece, and redraws once
 * (`attempts` pictures in all) when something is cut off or left out, e.g. trousers under a long kurta.
 * Each redraw names what was missing and puts those pieces' photos first. Returns the best picture.
 */
export async function drawTryOn(
  images: Pick<ImageAI, "generate">,
  stylist: Pick<StylistAI, "checkTryOn">,
  req: { prompt: string; labels: string[]; garments?: ImageBytes[]; face?: ImageBytes | null; width: number; height: number },
  attempts = 2,
): Promise<ImageBytes | null> {
  let best: { image: ImageBytes; faults: number } | null = null
  let order = req.labels.map((_, i) => i)
  let fix = ""
  for (let i = 0; i < attempts; i++) {
    let image: ImageBytes | null
    try {
      image = await images.generate({
        ...req,
        prompt: `${req.prompt} ${fix}`.trim(),
        redraw: i > 0,
        labels: order.map((j) => req.labels[j]),
        garments: req.garments && order.map((j) => req.garments![j]),
      })
    } catch (err) {
      // a failed redraw still leaves the earlier picture
      if (best) return best.image
      throw err
    }
    if (!image) return null
    const check = await lookAt(stylist, image, req.labels)
    if (!check) return best?.image ?? image
    const faults = check.missing.length * 2 + (check.fullBody ? 0 : 1)
    if (!best || faults < best.faults) best = { image, faults }
    if (!faults) break
    console.warn(`[tryon] picture ${i + 1} of ${attempts}: ${check.fullBody ? "" : "person cut off; "}missing: ${check.missing.join(", ") || "none"}`)
    const missing = new Set(check.missing)
    order = [...order.filter((j) => missing.has(req.labels[j])), ...order.filter((j) => !missing.has(req.labels[j]))]
    fix = [
      check.missing.length ? `Most important: the person is visibly wearing ${check.missing.join(" and ")}, shown clearly and in full.` : "",
      check.fullBody ? "" : "Zoom out so the whole person fits, from the top of the head to the shoes, with space around them.",
    ].filter(Boolean).join(" ")
  }
  return best!.image
}
