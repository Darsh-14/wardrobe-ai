// End-to-end API test against a real local Postgres with the project's migrations + seed,
// the mock stylist, mock weather and local file storage.
// Needs PGURL (admin connection), e.g. postgres://postgres:postgres@localhost:5432/postgres
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SignJWT } from "jose"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createMockStylist } from "../src/ai/mock.js"
import { createApp } from "../src/app.js"
import { loadConfig } from "../src/config.js"
import { createDb } from "../src/db.js"
import { Jobs, type Deps } from "../src/deps.js"
import { zonedDate } from "../src/routes/looks.js"
import { createStorage } from "../src/storage.js"
import { createWeather } from "../src/weather.js"

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432/postgres"
const SECRET = "test-secret-at-least-32-characters-long!!"
const MAYA = "00000000-0000-0000-0000-00000000a11a"
const EVE = "00000000-0000-0000-0000-0000000000ee"
const LOOK = "00000000-0000-0000-0000-0000000100c1"

let deps: Deps
let app: ReturnType<typeof createApp>

const token = (sub: string) =>
  new SignJWT({ role: "authenticated", email: `${sub}@test` })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET))

async function call(user: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (user) headers.authorization = `Bearer ${await token(user)}`
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers["content-type"] = "application/json"
    payload = JSON.stringify(body)
  }
  const res = await app.request(path, { method, headers, body: payload })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

beforeAll(async () => {
  const url = execFileSync("bash", ["scripts/local-db.sh", "wardrobe_api_test"], { env: { ...process.env, PGURL } })
    .toString()
    .trim()
  const config = loadConfig({
    DATABASE_URL: url,
    SUPABASE_JWT_SECRET: SECRET,
    AI_PROVIDER: "mock",
    STORAGE_DRIVER: "local",
    LOCAL_STORAGE_DIR: mkdtempSync(join(tmpdir(), "wardrobe-")),
    WEATHER_PROVIDER: "mock",
  })
  const db = createDb(config.DATABASE_URL)
  await db.sql`insert into auth.users (id, email) values (${EVE}, 'eve@example.com')`
  deps = {
    config,
    db,
    storage: createStorage(config),
    stylist: createMockStylist(),
    images: { enabled: false, generate: async () => null, removeBackground: async () => null },
    weather: createWeather(db, "mock"),
    jobs: new Jobs(),
  }
  app = createApp(deps, { log: false })
}, 60_000)

afterAll(async () => {
  await deps?.jobs.idle()
  await deps?.db.end()
})

describe("auth", () => {
  it("health is public", async () => {
    expect((await call(null, "GET", "/api/health")).body.ok).toBe(true)
  })
  it("rejects missing and bad tokens", async () => {
    expect((await call(null, "GET", "/api/me")).status).toBe(401)
    const res = await app.request("/api/me", { headers: { authorization: "Bearer nope" } })
    expect(res.status).toBe(401)
  })
})

describe("profile and home", () => {
  it("GET /api/me returns the UserProfile shape", async () => {
    const { status, body } = await call(MAYA, "GET", "/api/me")
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: "Maya Sharma", city: "New Delhi", profileCompletion: 92 })
    expect(body.styleTags).toHaveLength(4)
    expect(body.avatarUrl).toMatch(/^https:/)
  })

  it("stats, summary and weather", async () => {
    expect((await call(MAYA, "GET", "/api/me/stats")).body).toEqual({ wardrobeCount: 9, savedLooks: 1, daysStyled: 0 })
    const summary = (await call(MAYA, "GET", "/api/wardrobe/summary")).body
    expect(summary.map((s: { label: string; count: number }) => [s.label, s.count])).toEqual([
      ["Tops", 3],
      ["Outerwear", 2],
      ["Bottoms", 1],
      ["Shoes & more", 3],
    ])
    expect((await call(MAYA, "GET", "/api/weather")).body).toMatchObject({ tempC: 22, location: "New Delhi" })
  })

  it("PATCH /api/me updates fields and recomputes completion", async () => {
    const { status, body } = await call(MAYA, "PATCH", "/api/me", { stylePrefs: { fit: "relaxed" } })
    expect(status).toBe(200)
    expect(body.stylePrefs).toEqual({ fit: "relaxed" })
    expect(body.profileCompletion).toBe(75) // 6 of 8 checks (no body profile, < 10 items)
    expect((await call(MAYA, "PATCH", "/api/me", { bogus: 1 })).status).toBe(400)
  })
})

describe("wardrobe", () => {
  it("filters by category", async () => {
    expect((await call(MAYA, "GET", "/api/wardrobe/items")).body).toHaveLength(9)
    expect((await call(MAYA, "GET", "/api/wardrobe/items?category=All%20items")).body).toHaveLength(9)
    const tops = (await call(MAYA, "GET", "/api/wardrobe/items?category=Tops")).body
    expect(tops).toHaveLength(3)
    expect(tops[0]).toHaveProperty("wornOften")
    expect((await call(MAYA, "GET", "/api/wardrobe/items?category=Hats")).status).toBe(400)
  })

  it("scan -> add -> favorite -> delete", async () => {
    const form = new FormData()
    form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "shirt.png", { type: "image/png" }))
    const scan = await call(MAYA, "POST", "/api/wardrobe/scan", form)
    expect(scan.status).toBe(200)
    expect(scan.body.attributes[0]).toEqual(["Category", "Top · Button-down"])
    expect(scan.body.item.imagePath).toMatch(new RegExp(`^${MAYA}/`))

    const { aiAttributes: _, ...item } = scan.body.item
    expect((await call(EVE, "POST", "/api/wardrobe/items", item)).status).toBe(400) // not Eve's photo
    const added = await call(MAYA, "POST", "/api/wardrobe/items", { ...item, aiAttributes: scan.body.item.aiAttributes })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({ name: "Ivory poplin shirt", category: "Tops" })

    const fav = await call(MAYA, "PATCH", `/api/wardrobe/items/${added.body.id}`, { favorite: true })
    expect(fav.body.favorite).toBe(true)
    expect((await call(EVE, "PATCH", `/api/wardrobe/items/${added.body.id}`, { favorite: false })).status).toBe(404)
    expect((await call(EVE, "DELETE", `/api/wardrobe/items/${added.body.id}`)).status).toBe(404)
    expect((await call(MAYA, "DELETE", `/api/wardrobe/items/${added.body.id}`)).status).toBe(204)
  })

  it("rejects non-image uploads", async () => {
    const form = new FormData()
    form.append("file", new File(["hi"], "a.txt", { type: "text/plain" }))
    expect((await call(MAYA, "POST", "/api/wardrobe/scan", form)).status).toBe(415)
  })
})

describe("looks", () => {
  let lookId: string

  it("generates a look from the wardrobe", async () => {
    const { status, body } = await call(MAYA, "POST", "/api/looks/generate", {
      occasion: "Office",
      style: "Minimal",
      location: "Hauz Khas, New Delhi",
      date: "2025-10-18",
      time: "18:30",
    })
    expect(status).toBe(201)
    lookId = body.id
    expect(body).toMatchObject({ title: "Relaxed city layers", timeOfDay: "Evening", tempC: 22, status: "ready" })
    expect(body.items.length).toBeGreaterThan(1)
    expect(body.items[0].meta).toMatch(/^Tops/)
    expect(body.visualizationUrl).toMatch(/^https:/) // falls back to the first item's photo
    await deps.jobs.idle()
    expect((await call(MAYA, "GET", `/api/looks/${lookId}`)).body.visualizationStatus).toBe("failed")
  })

  it("Try another gives a different combination", async () => {
    const first = (await call(MAYA, "GET", `/api/looks/${lookId}`)).body.items.map((i: { wardrobeItemId: string }) => i.wardrobeItemId)
    const again = await call(MAYA, "POST", "/api/looks/generate", { occasion: "Office", style: "Minimal" })
    expect(again.status).toBe(201)
    expect(again.body.items.map((i: { wardrobeItemId: string }) => i.wardrobeItemId).sort()).not.toEqual([...first].sort())
  })

  it("swaps an item", async () => {
    const look = (await call(MAYA, "GET", `/api/looks/${lookId}`)).body
    const top = look.items[0].wardrobeItemId
    const altRes = await call(MAYA, "POST", `/api/looks/${lookId}/swap`, { wardrobeItemId: top })
    expect(altRes.status, JSON.stringify(altRes.body)).toBe(200)
    const alts = altRes.body.alternatives
    expect(alts.length).toBeGreaterThan(0)
    expect(alts.every((a: { category: string }) => a.category === "Tops")).toBe(true)
    const swapped = await call(MAYA, "POST", `/api/looks/${lookId}/swap`, { wardrobeItemId: top, replacementId: alts[0].id })
    expect(swapped.status).toBe(200)
    expect(swapped.body.items[0].wardrobeItemId).toBe(alts[0].id)
  })

  it("save, wear, today's pick and saved list", async () => {
    expect((await call(MAYA, "POST", `/api/looks/${lookId}/save`)).body).toEqual({ saved: true })
    expect((await call(MAYA, "GET", "/api/me/stats")).body.savedLooks).toBe(2)
    expect((await call(MAYA, "DELETE", `/api/looks/${lookId}/save`)).body).toEqual({ saved: false })
    expect((await call(MAYA, "POST", `/api/looks/${LOOK}/wear`)).body).toEqual({ logged: true })
    expect((await call(MAYA, "POST", `/api/looks/${LOOK}/wear`)).body).toEqual({ logged: false })
    expect((await call(MAYA, "GET", "/api/me/stats")).body.daysStyled).toBe(1)
    const today = (await call(MAYA, "GET", "/api/looks/today")).body
    expect(today).toMatchObject({ title: "Relaxed city layers" })
    expect((await call(MAYA, "GET", "/api/looks?saved=true")).body).toHaveLength(1)
  })

  it("other users can't see or touch the look", async () => {
    expect((await call(EVE, "GET", `/api/looks/${LOOK}`)).status).toBe(404)
    expect((await call(EVE, "POST", `/api/looks/${LOOK}/save`)).status).toBe(404)
    expect((await call(EVE, "POST", `/api/looks/${LOOK}/wear`)).status).toBe(404)
    expect((await call(EVE, "GET", "/api/me")).body.name).toBe("")
    expect((await call(EVE, "POST", "/api/looks/generate", { occasion: "Party", style: "Trendy" })).status).toBe(400)
    expect((await call(MAYA, "GET", "/api/looks/not-a-uuid")).status).toBe(404)
  })

  it("converts the form's local date and time", () => {
    expect(zonedDate("2025-10-18", "18:30", "Asia/Kolkata")?.toISOString()).toBe("2025-10-18T13:00:00.000Z")
    expect(zonedDate("2025-07-01", "09:00", "Europe/London")?.toISOString()).toBe("2025-07-01T08:00:00.000Z")
    expect(zonedDate("", "", "Asia/Kolkata")).toBeNull()
  })
})

describe("trends, recommendations, shopping", () => {
  it("returns seeded trends and generates for a new city once", async () => {
    expect((await call(MAYA, "GET", "/api/trends")).body).toHaveLength(6)
    const [a, b] = await Promise.all([
      call(MAYA, "GET", "/api/trends?location=Bandra,%20Mumbai"),
      call(EVE, "GET", "/api/trends?location=Mumbai"),
    ])
    expect(a.body).toHaveLength(4)
    expect(b.body.map((t: { id: string }) => t.id)).toEqual(a.body.map((t: { id: string }) => t.id))
  })

  it("recommendation: seeded, refresh, dismiss", async () => {
    const rec = (await call(MAYA, "GET", "/api/recommendations")).body
    expect(rec).toMatchObject({ ownedItemName: "The soft knit set", estimatedPrice: "₹3,490", styleMatch: 94, newLooks: 7 })
    const fresh = await call(MAYA, "POST", "/api/recommendations/refresh")
    expect(fresh.status).toBe(201)
    expect((await call(MAYA, "POST", `/api/recommendations/${fresh.body.id}/dismiss`)).status).toBe(204)
    expect((await call(MAYA, "GET", "/api/recommendations")).body.id).toBe(rec.id)
    expect((await call(EVE, "GET", "/api/recommendations")).status).toBe(409) // empty wardrobe
  })

  it("shopping ask", async () => {
    const { status, body } = await call(MAYA, "POST", "/api/shopping/ask", { prompt: "I have a wedding next month. What should I buy?" })
    expect(status).toBe(201)
    expect(body.gapTitle).toBe("Emerald occasion set")
    expect(body.ownedItems.length).toBeGreaterThan(0)
    expect((await call(MAYA, "GET", `/api/shopping/${body.id}`)).body.id).toBe(body.id)
    expect((await call(EVE, "GET", `/api/shopping/${body.id}`)).status).toBe(404)
  })
})
