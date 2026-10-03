// The Gemini adapter against a fake Gemini endpoint: request shape, JSON parsing, retries, bad output.
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, expect, it } from "vitest"
import { geminiAsk, setRetryDelay } from "../src/ai/gemini.js"
import { createStylist } from "../src/ai/stylist.js"

let server: Server
let base = ""
const requests: { url: string; body: any }[] = []
let replies: { status: number; json: unknown }[] = []

const answer = (obj: unknown) => ({
  status: 200,
  json: { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }] },
})

beforeAll(async () => {
  setRetryDelay(10)
  server = createServer((req, res) => {
    let data = ""
    req.on("data", (c) => (data += c))
    req.on("end", () => {
      requests.push({ url: req.url!, body: JSON.parse(data) })
      const r = replies.shift() ?? { status: 500, json: { error: { code: 500, message: "no reply queued" } } }
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.json))
    })
  })
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const stylist = () => createStylist(geminiAsk("test-key", "gemini-2.5-flash", base))

it("scans a photo with a JSON schema and normalises the category", async () => {
  replies = [
    answer({ name: "Blue jeans", category: "jeans", subcategory: "Straight", color: "Blue", pattern: "Solid",
      material: "Denim", style: "Casual", season: "All season", isClothing: true }),
  ]
  const r = await stylist().scanItem({ data: "aGk=", mediaType: "image/png" })
  expect(r.category).toBe("Bottoms")
  const req = requests.at(-1)!
  expect(req.url).toContain("models/gemini-2.5-flash:generateContent")
  expect(req.body.contents[0].parts[0].inlineData).toEqual({ data: "aGk=", mimeType: "image/png" })
  expect(req.body.generationConfig.responseMimeType).toBe("application/json")
  expect(req.body.generationConfig.responseJsonSchema.properties.category.type).toBe("string")
  expect(req.body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
  expect(req.body.systemInstruction.parts[0].text).toMatch(/Wardrobe AI/)
})

it("retries once on a rate limit", async () => {
  replies = [
    { status: 429, json: { error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } } },
    answer({ trends: [{ name: "Soft tailoring", subtitle: "Relaxed suits", visualPrompt: "x" }] }),
  ]
  const r = await stylist().cityTrends({ city: "Pune", month: "October" })
  expect(r.trends[0].name).toBe("Soft tailoring")
})

it("rejects answers that don't match the schema", async () => {
  replies = [answer({ itemIds: "not-an-array" })]
  await expect(
    stylist().generateLook({ occasion: "Office", style: "Minimal", location: null, when: null, weather: null,
      wardrobe: [], profile: { name: "", city: null, styleDna: null, styleTags: [], bodyProfile: {}, stylePrefs: {} },
      trends: [], avoid: [] }),
  ).rejects.toThrow(/expected shape/)
})

it("falls back to the next model when one is busy, and says so when all are", async () => {
  const chain = () => createStylist(geminiAsk("test-key", ["gemini-3.8-flash", "gemini-flash-lite-latest"], base))
  const busy = { status: 503, json: { error: { code: 503, message: "high demand", status: "UNAVAILABLE" } } }
  replies = [busy, answer({ trends: [{ name: "Tonal neutrals", subtitle: "Soft beiges", visualPrompt: "x" }] })]
  const r = await chain().cityTrends({ city: "Pune", month: "October" })
  expect(r.trends[0].name).toBe("Tonal neutrals")
  expect(requests.at(-2)!.url).toContain("models/gemini-3.8-flash:")
  expect(requests.at(-1)!.url).toContain("models/gemini-flash-lite-latest:")
  expect(requests.at(-2)!.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" })

  replies = [busy, busy, busy]
  await expect(chain().cityTrends({ city: "Pune", month: "October" })).rejects.toMatchObject({ status: 503 })
})
