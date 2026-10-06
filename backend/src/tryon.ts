// "See it on you": the prompt for a picture of a model shaped like the user (Profile > Body & fit),
// wearing the look's pieces and posed at the place they're going.
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

export function tryOnPrompt(input: { body: BodyProfile; look: LookRow; items: ItemRow[]; scene?: string }) {
  const { body, look, items } = input
  const pieces = items.map((i) => [i.color, i.material, i.subcategory || i.name].filter(Boolean).join(" ")).join("; ")
  const auto = sceneFor(look.occasion, look.location)
  const setting = input.scene?.trim() || `${auto.scene}, ${auto.pose}`
  const light = timeOfDay(look.event_at)
  const weather = look.weather?.condition ? `, ${look.weather.condition.toLowerCase()} weather` : ""
  return [
    `Photorealistic full-body fashion photo of ${describePerson(body)}.`,
    `Wearing: ${pieces}.`,
    `Setting and pose: ${setting} (${look.occasion}).`,
    `${light === "Today" ? "Natural daylight" : `${light} light`}${weather}.`,
    "Head to toe in frame with the shoes visible, 3:4 portrait, true-to-life colours, sharp focus, no text.",
  ].join(" ")
}
