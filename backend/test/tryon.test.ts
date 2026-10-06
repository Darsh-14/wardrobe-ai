import sharp from "sharp"
import { expect, it, vi } from "vitest"
import { aspectRatio, createImageAI, fitReference, QUOTA_MESSAGE, QuotaError } from "../src/ai/images.js"
import type { ItemRow, LookRow } from "../src/queries.js"
import { createStylist, type Ask } from "../src/ai/stylist.js"
import { drawTryOn, garmentLabels, tryOnPrompt } from "../src/tryon.js"
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
  expect(p).toContain("from the top of the head to the feet is in frame")
  expect(tryOnPrompt({ body: {}, look, items, scene: "on the steps of a glass tower" })).toContain(
    "Setting and pose: on the steps of a glass tower (Office).",
  )
})

it("names each piece and keeps the bottoms visible under the top", () => {
  const outfit = [
    { name: "Yellow kurta", category: "Tops", color: "Yellow", material: "Cotton", subcategory: "Kurta" },
    { name: "Jeans", category: "Bottoms", color: "Blue", material: "Denim", subcategory: "Straight jeans" },
  ] as ItemRow[]
  expect(garmentLabels(outfit)).toEqual(["top: Yellow Cotton Kurta", "bottoms: Blue Denim Straight jeans"])
  expect(tryOnPrompt({ body: { model: "Woman" }, look, items: outfit })).toContain(
    "The Yellow Cotton Kurta is worn over the Blue Denim Straight jeans, and the Blue Denim Straight jeans are clearly visible below its hem all the way down to the ankles.",
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
  expect(studioPrompt({ ...base, category: "Bottoms" })).toMatch(/^Ghost mannequin product photo of Light blue Denim Straight jeans .*full and rounded as if worn/)
  expect(studioPrompt({ ...base, category: "Tops" })).toMatch(/^Ghost mannequin product photo/)
  expect(studioPrompt({ ...base, category: "Dresses" })).toContain("full and rounded as if worn")
  // every kind of item comes out three-dimensional, not flat
  for (const category of ["Tops", "Outerwear", "Dresses", "Bottoms", "Shoes", "Accessories"] as const) {
    expect(studioPrompt({ ...base, category })).toContain("three-dimensional with real volume")
    expect(studioEditPrompt({ ...base, category })).toContain("three-dimensional with real volume")
  }
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
    "A man at the office. Images 0 to 1 are the user's own clothes. Dress the person in exactly all of these pieces together, every one clearly visible, keeping their colours, wash, prints, details and cut. Image 2 is the person's face: the person must look like them.",
  )
  expect((forms[1].form.get("input_image_2") as Blob).type).toBe("image/png")

  // labelled photos say which piece each one is
  await cf.generate({ prompt: "A woman.", garments: [jeans, jeans], labels: ["top: Yellow Cotton Kurta", "bottoms: Blue Denim Jeans"] })
  expect(forms[2].form.get("prompt")).toContain("Image 0 is the user's top: Yellow Cotton Kurta. Image 1 is the user's bottoms: Blue Denim Jeans.")
})

it("uses the try-on model for try-ons only, and falls back when it fails", async () => {
  const urls: string[] = []
  const cf = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "none",
    pollinationsUrl: "",
    cloudflare: { accountId: "acc", token: "tok", model: "m1", editModel: "klein-4b", tryOnModel: "klein-9b" },
    fetch: (async (url: string) => {
      urls.push(url.split("/").pop()!)
      // the bigger model is out of free quota today
      return url.endsWith("klein-9b") ? Response.json({ errors: [{ message: "quota" }] }, { status: 429 }) : Response.json({ result: { image: Buffer.from([0xff]).toString("base64") } })
    }) as typeof fetch,
  })
  const shirt = { bytes: new Uint8Array([1]), contentType: "image/jpeg" }
  expect(await cf.generate({ prompt: "try-on", garments: [shirt] })).not.toBeNull()
  expect(urls).toEqual(["klein-9b", "klein-4b"])
  await cf.generate({ prompt: "studio", garments: [shirt], mode: "studio" })
  expect(urls.slice(2)).toEqual(["klein-4b"])
})

it("shrinks phone photos below the 512x512 FLUX.2 limit before sending them", async () => {
  const forms: FormData[] = []
  const cf = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "none",
    pollinationsUrl: "",
    cloudflare: { accountId: "acc", token: "tok", model: "m1", editModel: "@cf/black-forest-labs/flux-2-klein-4b" },
    fetch: (async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData)
      return Response.json({ result: { image: Buffer.from([0xff, 1]).toString("base64") } })
    }) as typeof fetch,
  })
  const phone = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#4a6fa5" } }).jpeg().toBuffer()
  const cutout = await sharp({ create: { width: 900, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  await cf.generate({
    prompt: "x",
    garments: [{ bytes: new Uint8Array(phone), contentType: "image/jpeg" }, { bytes: new Uint8Array(cutout), contentType: "image/png" }],
  })
  for (const [i, type] of [[0, "image/jpeg"], [1, "image/png"]] as const) {
    const blob = forms[0].get(`input_image_${i}`) as Blob
    expect(blob.type).toBe(type)
    const meta = await sharp(Buffer.from(await blob.arrayBuffer())).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBeLessThan(512)
  }
  // already small enough: sent untouched
  const small = { bytes: new Uint8Array(await sharp({ create: { width: 300, height: 400, channels: 3, background: "#fff" } }).jpeg().toBuffer()), contentType: "image/jpeg" }
  expect(await fitReference(small)).toBe(small)
})

it("asks to keep the same garment and fill in hidden parts", () => {
  const p = studioEditPrompt({ name: "Light blue wash jeans", category: "Bottoms", color: "Light blue", material: "Denim", pattern: "Solid", subcategory: "Straight jeans" })
  expect(p).toContain("Image 0 is a phone photo of the user's Light blue wash jeans.")
  expect(p).toContain("full and rounded as if worn")
  expect(p).toContain("complete it so it matches the visible part")
})

it("redraws a try-on picture that leaves out the jeans, putting the jeans first", async () => {
  const pieces = ["top: Yellow Cotton Kurta", "bottoms: Blue Denim Jeans"]
  const kurta = { bytes: new Uint8Array([1]), contentType: "image/jpeg" }
  const jeans = { bytes: new Uint8Array([2]), contentType: "image/jpeg" }
  const asked: { prompt: string; labels?: string[]; garments?: unknown[] }[] = []
  const images = {
    generate: async (req: { prompt: string; labels?: string[]; garments?: unknown[] }) => {
      asked.push(req)
      return { bytes: new Uint8Array([asked.length]), contentType: "image/jpeg" }
    },
  }
  // the first picture is cut off at the thighs, the second is right
  const answers = [{ fullBody: false, missing: ["bottoms: Blue Denim Jeans"] }, { fullBody: true, missing: [] }]
  const stylist = { checkTryOn: async () => answers.shift()! }
  const image = await drawTryOn(images, stylist, { prompt: "A woman.", labels: pieces, garments: [kurta, jeans], width: 1024, height: 1536 })
  expect(image?.bytes).toEqual(new Uint8Array([2]))
  expect(asked).toHaveLength(2)
  expect(asked.map((r) => (r as { redraw?: boolean }).redraw)).toEqual([false, true])
  expect(asked[1].labels).toEqual(["bottoms: Blue Denim Jeans", "top: Yellow Cotton Kurta"])
  expect(asked[1].garments).toEqual([jeans, kurta])
  expect(asked[1].prompt).toContain("visibly wearing bottoms: Blue Denim Jeans")
  expect(asked[1].prompt).toContain("Zoom out")
})

it("keeps the best picture, and doesn't redraw when it can't check", async () => {
  let n = 0
  const images = { generate: async () => ({ bytes: new Uint8Array([++n]), contentType: "image/jpeg" }) }
  // always missing something: three pictures, the one with the fewest faults wins
  const faults = [{ fullBody: false, missing: ["a", "b"] }, { fullBody: true, missing: ["b"] }, { fullBody: false, missing: ["b"] }]
  const picky = { checkTryOn: async () => faults.shift()! }
  expect((await drawTryOn(images, picky, { prompt: "x", labels: ["a", "b"], width: 1, height: 1 }, 3))?.bytes).toEqual(new Uint8Array([2]))
  expect(n).toBe(3)

  n = 0
  const busy = { checkTryOn: async () => { throw new Error("503") } }
  expect((await drawTryOn(images, busy, { prompt: "x", labels: ["a"], width: 1, height: 1 }))?.bytes).toEqual(new Uint8Array([1]))
  expect(n).toBe(1)
})

it("matches the checker's piece names even when shortened", async () => {
  const ask = (async () => ({ fullBody: true, missing: ["Blue Denim Jeans", "a hat"] })) as unknown as Ask
  const check = await createStylist(ask).checkTryOn({ image: { data: "", mediaType: "image/jpeg" }, pieces: ["top: Yellow Cotton Kurta", "bottoms: Blue Denim Jeans"] })
  expect(check.missing).toEqual(["bottoms: Blue Denim Jeans"])
})

it("stops calling Cloudflare once the daily free quota is used up, and says so", async () => {
  const urls: string[] = []
  const cf = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "none",
    pollinationsUrl: "",
    cloudflare: { accountId: "acc", token: "tok", model: "m1", editModel: "klein-4b", tryOnModel: "klein-9b" },
    fetch: (async (url: string) => {
      urls.push(url.split("/").pop()!)
      return Response.json(
        { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan" }] },
        { status: 429 },
      )
    }) as typeof fetch,
  })
  const shirt = { bytes: new Uint8Array([1]), contentType: "image/jpeg" }
  const tryOn = cf.generate({ prompt: "try-on", garments: [shirt] })
  await expect(tryOn).rejects.toBeInstanceOf(QuotaError)
  await expect(tryOn).rejects.toThrow(QUOTA_MESSAGE)
  // no pointless fallback to the 4B model: they share the quota
  expect(urls).toEqual(["klein-9b"])
  // later pictures fail straight away without calling Cloudflare
  await expect(cf.generate({ prompt: "studio", garments: [shirt], mode: "studio" })).rejects.toBeInstanceOf(QuotaError)
  expect(urls).toHaveLength(1)
})

it("redraws with the standard model, and other failures keep their reason", async () => {
  const urls: string[] = []
  const cf = createImageAI({
    replicateImageModel: "",
    replicateBgModel: "",
    freeImages: "none",
    pollinationsUrl: "",
    cloudflare: { accountId: "acc", token: "tok", model: "m1", editModel: "klein-4b", tryOnModel: "klein-9b" },
    fetch: (async (url: string) => {
      urls.push(url.split("/").pop()!)
      return Response.json({ errors: [{ code: 5000, message: "bad input" }] }, { status: 400 })
    }) as typeof fetch,
  })
  const shirt = { bytes: new Uint8Array([1]), contentType: "image/jpeg" }
  await expect(cf.generate({ prompt: "again", garments: [shirt], redraw: true })).rejects.toThrow(/No image provider could draw this picture \(HTTP 400 bad input\)/)
  expect(urls).toEqual(["klein-4b"])
})

it("draws try-ons with the paid Gemini image model, and keeps studio photos on Cloudflare", async () => {
  const gemini: { url: string; body: { contents: { parts: { inlineData?: unknown; text?: string }[] }[]; generationConfig?: { imageConfig?: unknown } } }[] = []
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    gemini.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([0x89, 2]).toString("base64"), mimeType: "image/png" } }] } }] })
  })
  try {
    const cloudflare: string[] = []
    const ai = createImageAI({
      replicateImageModel: "",
      replicateBgModel: "",
      freeImages: "none",
      pollinationsUrl: "",
      geminiKey: "paid-key",
      geminiImageModel: "gemini-nano-banana-2.1",
      cloudflare: { accountId: "acc", token: "tok", model: "m1", editModel: "klein-4b" },
      fetch: (async (url: string) => {
        cloudflare.push(url.split("/").pop()!)
        return Response.json({ result: { image: Buffer.from([0xff]).toString("base64") } })
      }) as typeof fetch,
    })
    const shirt = { bytes: new Uint8Array([1]), contentType: "image/jpeg" }
    const tryOn = await ai.generate({ prompt: "A woman.", garments: [shirt], labels: ["top: Yellow Kurta"], width: 1024, height: 1536 })
    expect(tryOn?.contentType).toBe("image/png")
    expect(gemini).toHaveLength(1)
    expect(gemini[0].url).toContain("gemini-nano-banana-2.1:generateContent")
    expect(gemini[0].body.generationConfig?.imageConfig).toEqual({ aspectRatio: "2:3", imageSize: "1K" })
    expect(gemini[0].body.contents[0].parts[0].inlineData).toBeTruthy()
    expect(gemini[0].body.contents[0].parts.at(-1)?.text).toContain("Image 0 is the user's top: Yellow Kurta.")
    expect(cloudflare).toEqual([])

    await ai.generate({ prompt: "studio", garments: [shirt], mode: "studio", width: 832, height: 1040 })
    expect(gemini).toHaveLength(1)
    expect(cloudflare).toEqual(["klein-4b"])
  } finally {
    vi.unstubAllGlobals()
  }
})

it("picks the closest Gemini picture shape", () => {
  expect(aspectRatio(1024, 1536)).toBe("2:3")
  expect(aspectRatio(832, 1040)).toBe("3:4")
  expect(aspectRatio(768, 1024)).toBe("3:4")
  expect(aspectRatio(1024, 1024)).toBe("1:1")
})
