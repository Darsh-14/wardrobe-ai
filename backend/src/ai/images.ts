// Image generation: look try-ons, recommendation, shopping and trend pictures. Providers are tried
// in order and the first picture wins; when none answers, callers fall back to the clothing photos
// (the web app then shows its own model built from the cutouts).
//  1. Gemini image model (GEMINI_IMAGE_MODEL, off by default): dresses the person in the actual
//     pieces and can use the face photo. Only free if Google offers a free quota for that model on
//     your key; a key with no billing account is never charged.
//  2. Replicate (REPLICATE_API_TOKEN): PAID, off unless a token is set.
//  3. Cloudflare Workers AI (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): FLUX.1 schnell on the
//     free plan, no card, about 200 images a day; when the day's quota is used up it errors, it
//     never bills. Draws from the description, so not the exact pieces or face.
//  4. Pollinations (FREE_IMAGES=pollinations): keyless, but now asks for payment after one image.
// Background removal for wardrobe photos runs in the browser (frontend/src/lib/cutout.ts); the
// Replicate remover here is only used when a token is set.
import { GoogleGenAI, type Part } from "@google/genai"
import type { ImageAI, ImageBytes, TryOnRequest } from "./types.js"

type Provider = { name: string; generate(req: TryOnRequest): Promise<ImageBytes> }

export type ImageOptions = {
  replicateToken?: string
  replicateImageModel: string
  replicateBgModel: string
  geminiKey?: string
  geminiImageModel?: string
  cloudflare?: { accountId: string; token: string; model: string }
  freeImages: "pollinations" | "none"
  pollinationsUrl: string
  fetch?: typeof fetch
}

export function createImageAI(opts: ImageOptions): ImageAI {
  const http = opts.fetch ?? fetch
  const providers: Provider[] = []
  if (opts.geminiKey && opts.geminiImageModel) providers.push(gemini(opts.geminiKey, opts.geminiImageModel))
  const replicate = opts.replicateToken ? replicateRunner(opts.replicateToken, http) : null
  if (replicate) {
    providers.push({
      name: "replicate",
      generate: (req) =>
        replicate(opts.replicateImageModel, { prompt: req.prompt, aspect_ratio: "3:4", output_format: "webp" }),
    })
  }
  if (opts.cloudflare) providers.push(cloudflare(opts.cloudflare, http))
  if (opts.freeImages === "pollinations") providers.push(pollinations(opts.pollinationsUrl, http))

  return {
    enabled: providers.length > 0,
    usesReferences: !!(opts.geminiKey && opts.geminiImageModel),
    async generate(req) {
      for (const p of providers) {
        try {
          return await p.generate(req)
        } catch (err) {
          console.warn(`[images] ${p.name} failed: ${(err as Error).message}`)
        }
      }
      if (providers.length) throw new Error("No image provider could draw this picture")
      return null
    },
    removeBackground: async (imageUrl) => (replicate ? replicate(opts.replicateBgModel, { image: imageUrl }) : null),
  }
}

function gemini(apiKey: string, model: string): Provider {
  const client = new GoogleGenAI({ apiKey })
  return {
    name: `gemini ${model}`,
    async generate(req) {
      const parts: Part[] = []
      for (const g of req.garments ?? []) parts.push({ inlineData: { data: base64(g.bytes), mimeType: g.contentType } })
      if (req.face) parts.push({ inlineData: { data: base64(req.face.bytes), mimeType: req.face.contentType } })
      const refs = [
        req.garments?.length ? `The first ${req.garments.length} images are the clothes to dress the person in; keep their exact colours, prints and cut.` : "",
        req.face ? "The last image is the person's face: the person should look like them." : "",
      ].join(" ")
      parts.push({ text: `${req.prompt} ${refs}`.trim() })
      const res = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["IMAGE", "TEXT"] },
      })
      const img = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
      if (!img?.data) throw new Error(`no image returned (${res.candidates?.[0]?.finishReason ?? "blocked"})`)
      return { bytes: Buffer.from(img.data, "base64"), contentType: img.mimeType ?? "image/png" }
    },
  }
}

function cloudflare(cf: { accountId: string; token: string; model: string }, http: typeof fetch): Provider {
  let queue: Promise<unknown> = Promise.resolve()
  const once = async (prompt: string) => {
    const res = await http(`https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/run/${cf.model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cf.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 8, seed: Math.floor(Math.random() * 1e9) }),
      signal: AbortSignal.timeout(90_000),
    })
    const body = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { message?: string }[] } | null
    const image = body?.result?.image
    if (!res.ok || !image) throw new Error(`HTTP ${res.status} ${body?.errors?.map((e) => e.message).join("; ") ?? ""}`)
    return { bytes: new Uint8Array(Buffer.from(image, "base64")), contentType: "image/jpeg" }
  }
  return {
    name: "cloudflare",
    // one at a time keeps a burst (a new wardrobe) inside the free plan's rate limit
    generate(req) {
      const run = queue.then(() => once(req.prompt))
      queue = run.catch(() => undefined)
      return run
    },
  }
}

// Free, keyless text-to-image. One request at a time: anonymous use is rate limited per IP.
function pollinations(baseUrl: string, http: typeof fetch): Provider {
  let queue: Promise<unknown> = Promise.resolve()
  const once = async (prompt: string) => {
    const url = new URL(`${baseUrl.replace(/\/?$/, "/")}${encodeURIComponent(prompt.slice(0, 1500))}`)
    url.search = new URLSearchParams({
      width: "768",
      height: "1024",
      model: "flux",
      nologo: "true",
      private: "true",
      seed: String(Math.floor(Math.random() * 1e9)),
      referrer: "wardrobe-ai",
    }).toString()
    const res = await http(url, { signal: AbortSignal.timeout(120_000) })
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`)
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: type }
  }
  return {
    name: "pollinations",
    generate(req) {
      const run = queue.then(() => once(req.prompt))
      queue = run.catch(() => undefined)
      return run
    },
  }
}

function replicateRunner(token: string, http: typeof fetch) {
  return async function run(model: string, input: Record<string, unknown>): Promise<ImageBytes> {
    const res = await http(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify({ input }),
    })
    let prediction = await res.json()
    if (!res.ok) throw new Error(`Replicate ${model}: ${res.status} ${prediction?.detail ?? ""}`)
    // Prefer: wait returns early for slow models; poll until done
    for (let i = 0; i < 60 && !["succeeded", "failed", "canceled"].includes(prediction.status); i++) {
      await new Promise((r) => setTimeout(r, 2000))
      prediction = await (await http(prediction.urls.get, { headers: { Authorization: `Bearer ${token}` } })).json()
    }
    if (prediction.status !== "succeeded") throw new Error(`Replicate ${model}: ${prediction.status} ${prediction.error ?? ""}`)
    const url: string = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
    const file = await http(url)
    if (!file.ok) throw new Error(`Replicate output download failed: ${file.status}`)
    return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.headers.get("content-type") ?? "image/webp" }
  }
}

const base64 = (b: Uint8Array) => Buffer.from(b).toString("base64")

/** Framing for the stylist's one-line picture prompts (recommendations, shopping, trends) */
export const editorial = (prompt: string) => `Editorial fashion photo, full body, natural light, plain city background. ${prompt}`
