// Prompts for the gen AI calls, shared by every provider. A provider only supplies `ask`:
// send one prompt (optionally with a photo) and return JSON matching the zod schema.
import type { z } from "zod"
import {
  LookResult,
  RecommendationResult,
  ScanResult,
  ShoppingResult,
  TrendsResult,
  TryOnCheck,
  toCategory,
  type ItemForAI,
  type ProfileForAI,
  type StylistAI,
} from "./types.js"

export const SYSTEM = `You are the stylist inside Wardrobe AI, a personal styling app used mostly in India.
You only suggest clothes the user already owns unless asked what to buy. Be specific and warm, never generic.
Write short, plain sentences in second person. Prices are in Indian rupees.`

export class AIError extends Error {}

export type Prompt = {
  text: string
  image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }
}

/** "light" for quick tagging, "normal" for outfit reasoning; providers map it to their own settings. */
export type Depth = "light" | "normal"

export type Ask = <S extends z.ZodType>(schema: S, prompt: Prompt, depth: Depth) => Promise<z.infer<S>>

export function createStylist(ask: Ask): StylistAI {
  const wardrobeJson = (items: ItemForAI[]) => JSON.stringify(items)
  const profileJson = (p: ProfileForAI) => JSON.stringify(p)

  return {
    scanItem: async (image) => {
      const r = await ask(
        ScanResult,
        {
          image,
          text: "Tag this clothing item for the user's digital wardrobe. Describe the main item only; ignore the background and any person wearing it. Include its bounding box.",
        },
        "light",
      )
      return { ...r, category: toCategory(r.category) }
    },

    generateLook: (input) => {
      const when = input.when ? input.when.toISOString() : "today"
      return ask(
        LookResult,
        { text: `Build one outfit from the wardrobe below.

<request>
occasion: ${input.occasion}
style: ${input.style}
location: ${input.location ?? "not given"}
when (UTC): ${when}
weather: ${input.weather ? JSON.stringify(input.weather) : "unknown"}
local trends: ${input.trends.join(", ") || "none"}
</request>

<profile>${profileJson(input.profile)}</profile>

<wardrobe>${wardrobeJson(input.wardrobe)}</wardrobe>

${input.avoid.length ? `<already_suggested>${JSON.stringify(input.avoid)}</already_suggested>\nSuggest a clearly different combination from these.\n` : ""}
Pick 2-5 items using only ids from the wardrobe: at most one item per category except accessories, and a dress replaces top and bottom.
If style is "Let AI decide", choose the style that best fits the profile and occasion.` },
        "normal",
      )
    },

    recommend: (input) =>
      ask(
        RecommendationResult,
        { text: `Find the single purchase that would unlock the most new outfits with what this user already owns.

<profile>${profileJson(input.profile)}</profile>
<wardrobe>${wardrobeJson(input.wardrobe)}</wardrobe>

ownedItemId must be an id from the wardrobe. Estimate a typical Indian high-street price.` },
        "normal",
      ),

    shopping: (input) =>
      ask(
        ShoppingResult,
        { text: `The user asks: "${input.prompt.replace(/"/g, "'")}"

<profile>${profileJson(input.profile)}</profile>
<wardrobe>${wardrobeJson(input.wardrobe)}</wardrobe>

Answer with what they already own for this (ids from the wardrobe) and the one gap worth buying.` },
        "normal",
      ),

    cityTrends: (input) =>
      ask(
        TrendsResult,
        { text: `List 6 wearable fashion trends people in ${input.city} are wearing in ${input.month}, most popular first.
Keep them practical for everyday wardrobes and the local climate.` },
        "light",
      ),

    checkTryOn: async ({ image, pieces }) => {
      const r = await ask(
        TryOnCheck,
        {
          image,
          text: `This picture was generated to show one person wearing all of these pieces together:
${pieces.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Look carefully at the picture. Is the whole person in frame from the top of the head to both feet?
Which listed pieces can't be clearly seen being worn, for example because the picture is cut off above them,
another garment covers them completely, or a different garment was drawn instead? Long tops that cover the
upper part of trousers are fine as long as the trousers are visible below them.`,
        },
        "light",
      )
      // map each answer back to the listed name, even when it's shortened ("Blue Denim Jeans" for "bottoms: Blue Denim Jeans")
      const same = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase().trim())
      const missing = pieces.filter((p) => r.missing.some((m) => m.trim() && (same(p, m) || same(m, p))))
      return { fullBody: r.fullBody, missing }
    },
  }
}
