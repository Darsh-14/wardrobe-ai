// Shared data shapes. These mirror what the backend API will return, so the
// mock data in src/data/mock.ts can be swapped for real fetches screen by screen.

export type Screen = "home" | "generator" | "loading" | "look" | "wardrobe" | "add" | "recommendations" | "shopping" | "trends" | "profile"

export type Category = "Tops" | "Bottoms" | "Dresses" | "Outerwear" | "Shoes" | "Accessories"

export type Weather = {
  tempC: number
  condition: string
  advice: string
}

export type UserProfile = {
  name: string
  city: string
  avatarUrl: string
  profileCompletion: number
  styleDna: string
  styleTags: string[]
}

export type UserStats = {
  wardrobeCount: number
  savedLooks: number
  daysStyled: number
}

export type WardrobeItem = {
  id: string
  name: string
  category: Category
  color: string
  season: string
  imageUrl: string
  wornOften: boolean
  favorite?: boolean
}

export type CategorySummary = {
  label: string
  count: number
  imageUrl: string
}

export type LookRequest = {
  occasion: string
  style: string
  location: string
  date: string
  time: string
}

export type LookItem = {
  wardrobeItemId: string
  name: string
  meta: string
  imageUrl: string
}

export type GeneratedLook = {
  id: string
  title: string
  visualizationUrl: string
  timeOfDay: string
  tempC: number
  styleMatch: number
  reasoning: string
  tags: string[]
  items: LookItem[]
}

export type Trend = {
  id: string
  name: string
  subtitle: string
  imageUrl: string
}

export type Recommendation = {
  ownedItemName: string
  ownedItemImageUrl: string
  suggestedImageUrl: string
  description: string
  estimatedPrice: string
  styleMatch: number
  newLooks: number
  visualizationUrl: string
}

export type ShoppingAdvice = {
  ownedItems: string[]
  gapTitle: string
  gapDescription: string
  visualizationUrl: string
}

export type ItemScan = {
  imageUrl: string
  durationSec: number
  attributes: [label: string, value: string][]
}
