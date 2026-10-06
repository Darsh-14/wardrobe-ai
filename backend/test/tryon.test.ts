import { expect, it } from "vitest"
import { createImageAI } from "../src/ai/images.js"
import type { ItemRow, LookRow } from "../src/queries.js"
import { tryOnPrompt } from "../src/tryon.js"
import { studioEditPrompt, studioPrompt } from "../src/studio.js"

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

it("asks for catalogue-style studio photos that match the samples", () => {
  const base = { name: "Light blue wash jeans", color: "Light blue", material: "Denim", pattern: "Solid", subcategory: "Straight jeans" }
  expect(studioPrompt({ ...base, category: "Bottoms" })).toMatch(/^Product photo of Light blue Denim Straight jeans .*folded over a wooden trouser hanger/)
  expect(studioPrompt({ ...base, category: "Tops" })).toMatch(/^Ghost mannequin product photo/)
  expect(studioPrompt({ ...base, category: "Dresses" })).toContain("dress form mannequin")
  expect(studioPrompt({ ...base, pattern: "Floral", category: "Tops" })).toContain("floral Straight jeans")
})

it("draws on Cloudflare Workers AI's free plan", async () => {
  const calls: { url: string; body: string; auth: string }[] = []
  const cf = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "none",
    pollinationsUrl: "",
    cloudflare: { accountId: "acc", token: "tok", model: "@cf/black-forest-labs/flux-1-schnell", editModel: "@cf/black-forest-labs/flux-2-klein-4b" },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).Authorization })
      return Response.json({ success: true, result: { image: Buffer.from([7, 8]).toString("base64") } })
    }) as typeof fetch,
  })
  expect(await cf.generate({ prompt: "a shirt" })).toEqual({ bytes: new Uint8Array([7, 8]), contentType: "image/jpeg" })
  expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/black-forest-labs/flux-1-schnell")
  expect(calls[0].auth).toBe("Bearer tok")
  expect(JSON.parse(calls[0].body)).toMatchObject({ prompt: "a shirt", steps: 8 })
})

it("edits from the user's own photos with FLUX.2 klein", async () => {
  const forms: { url: string; form: FormData }[] = []
  const cf = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "none",
    pollinationsUrl: "",
    cloudflare: { accountId: "acc", token: "tok", model: "m1", editModel: "@cf/black-forest-labs/flux-2-klein-4b" },
    fetch: (async (url: string, init: RequestInit) => {
      forms.push({ url, form: init.body as FormData })
      return Response.json({ result: { image: Buffer.from([0x89, 1]).toString("base64") } })
    }) as typeof fetch,
  })
  expect(cf.usesReferences).toBe(true)
  const jeans = { bytes: new Uint8Array([1]), contentType: "image/jpeg" }
  const studio = await cf.generate({ prompt: "Image 0 is a phone photo of the user's jeans.", garments: [jeans], mode: "studio", width: 832, height: 1040 })
  expect(studio?.contentType).toBe("image/png")
  expect(forms[0].url).toMatch(/flux-2-klein-4b$/)
  expect(forms[0].form.get("prompt")).toBe("Image 0 is a phone photo of the user's jeans.")
  expect(forms[0].form.get("input_image_0")).toBeInstanceOf(Blob)
  expect(forms[0].form.get("width")).toBe("832")

  const face = { bytes: new Uint8Array([2]), contentType: "image/png" }
  await cf.generate({ prompt: "A man at the office.", garments: [jeans, jeans], face })
  expect(forms[1].form.get("prompt")).toBe(
    "A man at the office. Images 0 to 1 are the user's own clothes: dress the person in exactly these pieces, keeping their colours, wash, prints, details and cut. Image 2 is the person's face: the person must look like them.",
  )
  expect((forms[1].form.get("input_image_2") as Blob).type).toBe("image/png")
})

it("asks to keep the same garment and fill in hidden parts", () => {
  const p = studioEditPrompt({ name: "Light blue wash jeans", category: "Bottoms", color: "Light blue", material: "Denim", pattern: "Solid", subcategory: "Straight jeans" })
  expect(p).toContain("Image 0 is a phone photo of the user's Light blue wash jeans.")
  expect(p).toContain("wooden trouser hanger")
  expect(p).toContain("complete it so it matches the visible part")
})
