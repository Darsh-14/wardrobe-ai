// Placeholder content shown until the backend is connected. Each export maps to
// one API response (see plan/frontend-data-and-api.md in the project files).
import type {
  CategorySummary,
  GeneratedLook,
  ItemScan,
  Recommendation,
  ShoppingAdvice,
  Trend,
  UserProfile,
  UserStats,
  WardrobeItem,
  Weather,
} from "../types"

export const photos = {
  hero: "https://images.unsplash.com/photo-1628283866337-98faf3207e9f?auto=format&fit=crop&w=1400&q=88",
  office:
    "https://images.unsplash.com/photo-1599330293364-622fa6bfcf3a?auto=format&fit=crop&w=1000&q=86",
  street:
    "https://images.unsplash.com/photo-1721637686340-de9f8cebda5a?auto=format&fit=crop&w=1000&q=86",
  blazer:
    "https://images.unsplash.com/photo-1616847220575-31b062a4cd05?auto=format&fit=crop&w=1000&q=86",
  pink: "https://images.unsplash.com/photo-1582164256364-b0eccb922bff?auto=format&fit=crop&w=1000&q=86",
  group:
    "https://images.unsplash.com/photo-1572251328767-e59f06f13ba1?auto=format&fit=crop&w=1000&q=86",
  wardrobe:
    "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=1200&q=86",
  rack: "https://images.unsplash.com/photo-1603400521630-9f2de124b33b?auto=format&fit=crop&w=1000&q=86",
  jackets:
    "https://images.unsplash.com/photo-1551232864-3f0890e580d9?auto=format&fit=crop&w=1000&q=86",
  clothes:
    "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1000&q=86",
}

// GET /api/me
export const user: UserProfile = {
  name: "Maya Sharma",
  city: "New Delhi",
  avatarUrl: photos.group,
  profileCompletion: 92,
  styleDna: "Relaxed minimalism with a streetwear edge.",
  styleTags: [
    "Relaxed tailoring",
    "Neutral palette",
    "Silver accents",
    "Clean sneakers",
  ],
}

// GET /api/me/stats
export const stats: UserStats = {
  wardrobeCount: 87,
  savedLooks: 24,
  daysStyled: 31,
}

// GET /api/weather?location=
export const weather: Weather = {
  tempC: 22,
  condition: "Partly cloudy",
  advice: "Light layers recommended",
}

// GET /api/wardrobe/summary
export const categorySummaries: CategorySummary[] = [
  { label: "Tops", count: 24, imageUrl: photos.clothes },
  { label: "Outerwear", count: 12, imageUrl: photos.jackets },
  { label: "Bottoms", count: 18, imageUrl: photos.rack },
  { label: "Shoes & more", count: 33, imageUrl: photos.office },
]

export const wardrobeCategories = [
  "All items",
  "Tops",
  "Bottoms",
  "Dresses",
  "Outerwear",
  "Shoes",
  "Accessories",
]

// GET /api/wardrobe/items?category=
export const wardrobeItems: WardrobeItem[] = [
  {
    id: "w1",
    name: "Ivory poplin shirt",
    category: "Tops",
    color: "Ivory",
    season: "All season",
    imageUrl: photos.clothes,
    wornOften: true,
  },
  {
    id: "w2",
    name: "Black fitted blazer",
    category: "Outerwear",
    color: "Black",
    season: "All season",
    imageUrl: photos.blazer,
    wornOften: true,
  },
  {
    id: "w3",
    name: "Straight blue jeans",
    category: "Bottoms",
    color: "Blue",
    season: "All season",
    imageUrl: photos.rack,
    wornOften: true,
  },
  {
    id: "w4",
    name: "Soft knit set",
    category: "Tops",
    color: "Rose",
    season: "All season",
    imageUrl: photos.pink,
    wornOften: false,
  },
  {
    id: "w5",
    name: "Everyday neutrals",
    category: "Tops",
    color: "Mixed",
    season: "All season",
    imageUrl: photos.wardrobe,
    wornOften: false,
  },
  {
    id: "w6",
    name: "Camel trench",
    category: "Outerwear",
    color: "Camel",
    season: "All season",
    imageUrl: photos.jackets,
    wornOften: false,
  },
  {
    id: "w7",
    name: "City sneakers",
    category: "Shoes",
    color: "White",
    season: "All season",
    imageUrl: photos.street,
    wornOften: false,
  },
  {
    id: "w8",
    name: "Silk occasion set",
    category: "Dresses",
    color: "Multi",
    season: "All season",
    imageUrl: photos.group,
    wornOften: false,
  },
]

export const occasions = [
  "College",
  "Office",
  "Date",
  "Party",
  "Wedding",
  "Casual outing",
  "Travel",
  "Custom",
]
export const styles = [
  "Casual",
  "Streetwear",
  "Minimal",
  "Formal",
  "Trendy",
  "Traditional",
  "Elegant",
  "Let AI decide",
]

export const lookDefaults = {
  location: "Hauz Khas, New Delhi",
  date: "2025-10-18",
  time: "18:30",
}

// POST /api/looks/generate
export const generatedLook: GeneratedLook = {
  id: "look_1",
  title: "Relaxed city layers",
  visualizationUrl: photos.hero,
  timeOfDay: "Evening",
  tempC: 22,
  styleMatch: 96,
  reasoning:
    "This look combines your ivory oversized shirt with straight-fit jeans for an effortless streetwear silhouette—ideal for your evening outing.",
  tags: ["Color harmony", "Weather ready"],
  items: [
    {
      wardrobeItemId: "w1",
      name: "Ivory oversized shirt",
      meta: "Tops · Cotton",
      imageUrl: photos.clothes,
    },
    {
      wardrobeItemId: "w3",
      name: "Blue straight-fit jeans",
      meta: "Bottoms · Denim",
      imageUrl: photos.rack,
    },
    {
      wardrobeItemId: "w7",
      name: "White leather sneakers",
      meta: "Shoes · Leather",
      imageUrl: photos.wardrobe,
    },
    {
      wardrobeItemId: "w9",
      name: "Silver hoop earrings",
      meta: "Accessories · Silver",
      imageUrl: photos.jackets,
    },
  ],
}

// Home "Today's pick" card: GET /api/looks/today
export const todaysPick = {
  title: "Relaxed city layers",
  imageUrl: photos.office,
}

// GET /api/trends?location=  (home shows the first three)
export const homeTrends: Trend[] = [
  {
    id: "t1",
    name: "Soft tailoring",
    subtitle: "3 pieces you own",
    imageUrl: photos.blazer,
  },
  {
    id: "t2",
    name: "Layered streetwear",
    subtitle: "Ready to style",
    imageUrl: photos.street,
  },
  {
    id: "t3",
    name: "Tonal neutrals",
    subtitle: "5 possible looks",
    imageUrl: photos.pink,
  },
]

export const trends: Trend[] = [
  {
    id: "t4",
    name: "Oversized denim",
    subtitle: "4 pieces ready",
    imageUrl: photos.street,
  },
  {
    id: "t5",
    name: "Monochrome outfits",
    subtitle: "8 combinations",
    imageUrl: photos.office,
  },
  {
    id: "t2",
    name: "Layered streetwear",
    subtitle: "Ready to wear",
    imageUrl: photos.pink,
  },
  {
    id: "t6",
    name: "Minimal ethnic fusion",
    subtitle: "2 smart additions",
    imageUrl: photos.group,
  },
]

// GET /api/recommendations
export const recommendation: Recommendation = {
  ownedItemName: "The white crop top",
  ownedItemImageUrl: photos.clothes,
  suggestedImageUrl: photos.rack,
  description:
    "Pair it with a relaxed wide-leg jean to balance the cropped silhouette and unlock 7 new looks.",
  estimatedPrice: "₹3,490",
  styleMatch: 94,
  newLooks: 7,
  visualizationUrl: photos.office,
}

// POST /api/shopping/ask
export const shoppingDefaultPrompt =
  "I have a wedding next month. What should I buy?"
export const shoppingAdvice: ShoppingAdvice = {
  ownedItems: [
    "Black kitten heels",
    "Beige mini handbag",
    "Gold drop earrings",
  ],
  gapTitle: "Emerald occasion set",
  gapDescription:
    "A single statement piece completes the accessories and shoes you already own.",
  visualizationUrl: photos.group,
}

// POST /api/wardrobe/scan
export const itemScan: ItemScan = {
  imageUrl: photos.clothes,
  durationSec: 1.2,
  attributes: [
    ["Category", "Top · Button-down"],
    ["Color", "Ivory white"],
    ["Pattern", "Solid"],
    ["Material", "Cotton poplin"],
    ["Style", "Relaxed · Minimal"],
    ["Season", "All season"],
  ],
}
