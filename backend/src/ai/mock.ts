// Deterministic stand-in for local development and tests (AI_PROVIDER=mock). It answers from the
// user's real wardrobe with simple rules, so the whole API works without any API keys.
import type { Category, ItemForAI, StylistAI } from "./types.js"

const ORDER: Category[] = ["Tops", "Dresses", "Outerwear", "Bottoms", "Shoes", "Accessories"]

export function createMockStylist(): StylistAI {
  return {
    async scanItem() {
      return {
        name: "Ivory poplin shirt",
        category: "Tops",
        subcategory: "Button-down",
        color: "Ivory white",
        pattern: "Solid",
        material: "Cotton poplin",
        style: "Relaxed · Minimal",
        season: "All season",
        isClothing: true,
        box: [0, 0, 1000, 1000],
      }
    },

    async generateLook(input) {
      const avoid = new Set(input.avoid.map((ids) => [...ids].sort().join()))
      const byCat = (cat: Category) =>
        input.wardrobe.filter((i) => i.category === cat).sort((a, b) => b.wearCount - a.wearCount)
      // Try combinations in a fixed order until one hasn't been suggested yet
      for (let offset = 0; offset < 10; offset++) {
        const pick = (cat: Category) => {
          const list = byCat(cat)
          return list.length ? list[offset % list.length] : undefined
        }
        const items = [pick("Tops"), pick("Bottoms"), pick("Shoes"), pick("Accessories")].filter(
          (i): i is ItemForAI => !!i,
        )
        const ids = items.map((i) => i.id)
        if (ids.length && !avoid.has([...ids].sort().join())) {
          return {
            itemIds: ids.sort((a, b) => orderOf(input.wardrobe, a) - orderOf(input.wardrobe, b)),
            title: offset === 0 ? "Relaxed city layers" : `City layers, take ${offset + 1}`,
            reasoning: `This look pairs your ${items.map((i) => i.name.toLowerCase()).join(", ")} for an easy ${input.style.toLowerCase()} ${input.occasion.toLowerCase()} outfit.`,
            tags: ["Color harmony", "Weather ready"],
            styleMatch: 96 - offset,
            visualPrompt: `A person wearing ${items.map((i) => i.name).join(", ")}`,
          }
        }
      }
      return { itemIds: [], title: "Nothing new to suggest", reasoning: "", tags: [], styleMatch: 0, visualPrompt: "" }
    },

    async recommend(input) {
      const owned = input.wardrobe.find((i) => i.category === "Tops") ?? input.wardrobe[0]
      return {
        ownedItemId: owned?.id ?? "",
        productName: "Relaxed wide-leg jean",
        description: "Pair it with a relaxed wide-leg jean to balance the silhouette and unlock 7 new looks.",
        estimatedPriceInr: 3490,
        styleMatch: 94,
        newLooks: 7,
        visualPrompt: "Wide-leg jeans with a cropped top",
      }
    },

    async shopping(input) {
      const pick = input.wardrobe.filter((i) => ["Shoes", "Accessories"].includes(i.category)).slice(0, 3)
      return {
        ownedItemIds: pick.map((i) => i.id),
        gapTitle: "Emerald occasion set",
        gapDescription: "A single statement piece completes the accessories and shoes you already own.",
        visualPrompt: "An emerald occasion set",
      }
    },

    async cityTrends() {
      return {
        trends: [
          { name: "Soft tailoring", subtitle: "Relaxed suiting in soft fabrics", visualPrompt: "" },
          { name: "Layered streetwear", subtitle: "Easy layers for the city", visualPrompt: "" },
          { name: "Tonal neutrals", subtitle: "One colour, many textures", visualPrompt: "" },
          { name: "Oversized denim", subtitle: "Wide legs and boxy jackets", visualPrompt: "" },
        ],
      }
    },
  }
}

function orderOf(wardrobe: ItemForAI[], id: string) {
  const item = wardrobe.find((i) => i.id === id)
  return item ? ORDER.indexOf(item.category) : 99
}
