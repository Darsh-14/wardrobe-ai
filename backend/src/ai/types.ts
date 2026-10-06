import { z } from "zod"
import type { Weather } from "../weather.js"

export const CATEGORIES = ["Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Accessories"] as const
export type Category = (typeof CATEGORIES)[number]

// What the models see of the wardrobe (no image URLs, ids are the real uuids)
export type ItemForAI = {
  id: string
  name: string
  category: Category
  color: string | null
  material: string | null
  pattern: string | null
  style: string | null
  season: string
  wearCount: number
  favorite: boolean
}

export type ProfileForAI = {
  name: string
  city: string | null
  styleDna: string | null
  styleTags: string[]
  bodyProfile: unknown
  stylePrefs: unknown
}

// Schemas double as the structured-output formats sent to the model, so keep them to plain
// types (no min/max); results are clamped and checked in code.
export const ScanResult = z.object({
  name: z.string().describe("Short display name, e.g. 'Ivory poplin shirt'"),
  category: z.string().describe(`Exactly one of: ${CATEGORIES.join(", ")}`),
  subcategory: z.string().describe("e.g. 'Button-down', 'Wide-leg jeans', 'Sneakers'"),
  color: z.string(),
  pattern: z.string(),
  material: z.string(),
  style: z.string().describe("One or two words joined by ' · ', e.g. 'Relaxed · Minimal'"),
  season: z.string().describe("'All season', 'Summer', 'Winter', 'Monsoon', 'Spring/Autumn'"),
  isClothing: z.boolean().describe("false if the photo does not show a wearable item"),
  box: z
    .array(z.number())
    .describe("Tight bounding box of the main item only (not the person or background) as [ymin, xmin, ymax, xmax], each 0-1000")
    .optional(),
})
export type ScanResult = Omit<z.infer<typeof ScanResult>, "category"> & { category: Category }

/** Maps the model's category text onto the app's six categories ("top" -> "Tops"). */
export function toCategory(text: string): Category {
  const t = text.trim().toLowerCase()
  const hit = CATEGORIES.find((c) => c.toLowerCase() === t || c.toLowerCase() === `${t}s` || c.toLowerCase().startsWith(t))
  if (hit) return hit
  if (/shoe|sneaker|boot|heel|sandal/.test(t)) return "Shoes"
  if (/jacket|coat|blazer|trench/.test(t)) return "Outerwear"
  if (/dress|saree|sari|lehenga|gown|set/.test(t)) return "Dresses"
  if (/jean|trouser|pant|skirt|short/.test(t)) return "Bottoms"
  if (/shirt|tee|top|blouse|kurta|sweater/.test(t)) return "Tops"
  return "Accessories"
}

export const LookResult = z.object({
  itemIds: z.array(z.string()).describe("Wardrobe item ids, ordered top to bottom: tops/dresses, outerwear, bottoms, shoes, accessories"),
  title: z.string().describe("3-5 word outfit name, sentence case"),
  reasoning: z.string().describe("1-2 sentences in second person on why this works for the occasion, weather and style"),
  tags: z.array(z.string()).describe("2-3 short tags such as 'Color harmony', 'Weather ready'"),
  styleMatch: z.number().describe("0-100 fit with the user's style"),
  visualPrompt: z
    .string()
    .describe("One sentence for an image model: a specific, recognisable setting at the user's destination and a natural pose there, e.g. 'leaning on the sea wall at Marine Drive at sunset'. Don't describe the person or the clothes."),
})
export type LookResult = z.infer<typeof LookResult>

export const TryOnCheck = z.object({
  fullBody: z.boolean().describe("true only if the whole person is in the picture, from the top of the head down to both feet"),
  missing: z
    .array(z.string())
    .describe("each listed piece that is not clearly visible being worn (cut off, hidden, left out or replaced by a different garment), copied exactly from the list; empty when every piece is visible"),
})
export type TryOnCheck = z.infer<typeof TryOnCheck>

export const RecommendationResult = z.object({
  ownedItemId: z.string().describe("Id of the owned item the purchase unlocks the most with"),
  productName: z.string(),
  description: z.string().describe("One sentence: what to pair it with and how many new looks it unlocks"),
  estimatedPriceInr: z.number(),
  styleMatch: z.number(),
  newLooks: z.number(),
  visualPrompt: z.string(),
})
export type RecommendationResult = z.infer<typeof RecommendationResult>

export const ShoppingResult = z.object({
  ownedItemIds: z.array(z.string()).describe("Up to 3 owned items the user should wear for this"),
  gapTitle: z.string().describe("The one piece to buy, 2-4 words"),
  gapDescription: z.string().describe("One sentence on why it completes what they own"),
  visualPrompt: z.string(),
})
export type ShoppingResult = z.infer<typeof ShoppingResult>

export const TrendsResult = z.object({
  trends: z.array(
    z.object({
      name: z.string().describe("2-3 words, sentence case"),
      subtitle: z.string().describe("4-6 words"),
      visualPrompt: z.string(),
    }),
  ),
})
export type TrendsResult = z.infer<typeof TrendsResult>

export type LookInput = {
  occasion: string
  style: string
  location: string | null
  when: Date | null
  weather: Weather | null
  wardrobe: ItemForAI[]
  profile: ProfileForAI
  trends: string[]
  /** Previously suggested combinations to avoid ("Try another") */
  avoid: string[][]
}

export interface StylistAI {
  scanItem(image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }): Promise<ScanResult>
  generateLook(input: LookInput): Promise<LookResult>
  recommend(input: { wardrobe: ItemForAI[]; profile: ProfileForAI }): Promise<RecommendationResult>
  shopping(input: { prompt: string; wardrobe: ItemForAI[]; profile: ProfileForAI }): Promise<ShoppingResult>
  cityTrends(input: { city: string; month: string }): Promise<TrendsResult>
  /** Looks at a generated try-on picture: is the whole person in frame, and which pieces can't be seen? */
  checkTryOn(input: { image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }; pieces: string[] }): Promise<TryOnCheck>
}

export type ImageBytes = { bytes: Uint8Array; contentType: string }

export type TryOnRequest = {
  /** Full text prompt: the person, the clothes, the place and the pose */
  prompt: string
  /** Photos of the actual pieces (background removed where possible), for models that take images */
  garments?: ImageBytes[]
  /** What each garment photo shows, in the same order, e.g. "top: Yellow Cotton Kurta" */
  labels?: string[]
  /** Optional face photo the person should resemble */
  face?: ImageBytes | null
  /** "studio": redo the photo in `garments` as a catalogue shot (the prompt explains the image itself) */
  mode?: "tryon" | "studio"
  width?: number
  height?: number
}

export interface ImageAI {
  enabled: boolean
  /** true when a provider uses the garment and face photos (they are only downloaded then) */
  usesReferences?: boolean
  /** Returns image bytes, or null when no image provider is configured. */
  generate(req: TryOnRequest): Promise<ImageBytes | null>
  removeBackground(imageUrl: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
}
