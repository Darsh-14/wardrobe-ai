import { expect, it } from "vitest"
import { createImageAI } from "../src/ai/images.js"
import type { ItemRow, LookRow } from "../src/queries.js"
import { tryOnPrompt } from "../src/tryon.js"

const look = {
  occasion: "Office",
  location: "Bandra, Mumbai",
  event_at: new Date("2026-10-07T04:00:00Z"), // 9:30 in India
  weather: { tempC: 30, condition: "Humid", advice: "" },
} as LookRow
const items = [
  { name: "Ivory poplin shirt", color: "Ivory", material: "Cotton", subcategory: "Button-down" },
  { name: "Wide-leg jeans", color: "Light blue", material: null, subcategory: null },
] as ItemRow[]

it("describes the user's body, the pieces and a scene at the destination", () => {
  const p = tryOnPrompt({ body: { model: "Man", heightCm: 175, weightKg: 70, build: "Athletic" }, look, items })
  expect(p).toContain("one adult man, about 175 cm tall and about 70 kg, with an athletic build")
  expect(p).toContain("Wearing: Ivory Cotton Button-down; Light blue Wide-leg jeans.")
  expect(p).toContain("office lobby in Bandra, Mumbai")
  expect(p).toContain("Morning light, humid weather")
  expect(tryOnPrompt({ body: {}, look, items, scene: "on the steps of a glass tower" })).toContain(
    "Setting and pose: on the steps of a glass tower (Office).",
  )
})

it("draws with the free provider and reports failures", async () => {
  const urls: string[] = []
  const ok = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "pollinations",
    pollinationsUrl: "https://img.test/prompt",
    fetch: (async (url: URL) => {
      urls.push(String(url))
      return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } })
    }) as typeof fetch,
  })
  expect(ok.enabled).toBe(true)
  expect(ok.usesReferences).toBe(false)
  expect(await ok.generate({ prompt: "a person" })).toEqual({ bytes: new Uint8Array([1, 2]), contentType: "image/jpeg" })
  expect(urls[0]).toMatch(/^https:\/\/img\.test\/prompt\/a%20person\?width=768&height=1024/)

  const down = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "pollinations",
    pollinationsUrl: "https://img.test/prompt",
    fetch: (async () => new Response("busy", { status: 429, headers: { "content-type": "text/plain" } })) as typeof fetch,
  })
  await expect(down.generate({ prompt: "x" })).rejects.toThrow(/No image provider/)

  const off = createImageAI({ replicateImageModel: "", replicateBgModel: "", freeImages: "none", pollinationsUrl: "" })
  expect(off.enabled).toBe(false)
  expect(await off.generate({ prompt: "x" })).toBeNull()
})
