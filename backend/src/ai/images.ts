// Image generation: look try-ons, recommendation, shopping and trend pictures. Providers are tried
// in order and the first picture wins; when none answers, callers fall back to the clothing photos
// (the web app then shows its own model built from the cutouts).
//  1. Gemini image model (GEMINI_IMAGE_MODEL, off by default): dresses the person in the actual
//     pieces and can use the face photo. Only free if Google offers a free quota for that model on
//     your key; a key with no billing account is never charged.
//  2. Replicate (REPLICATE_API_TOKEN): PAID, off unless a token is set.
//  3. Cloudflare Workers AI (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN), free plan, no card,
//     10,000 neurons a day (a few hundred pictures); when they're used up it errors, it never bills.
//     With reference photos (the user's clothes, face) it uses FLUX.2 klein, which edits from them,
//     so pictures show the actual garment; text-only prompts use FLUX.1 schnell.
//  4. Pollinations (FREE_IMAGES=pollinations): keyless, but now asks for payment after one image.
// Background removal for wardrobe photos runs in the browser (frontend/src/lib/cutout.ts); the
// Replicate remover here is only used when a token is set.
import { GoogleGenAI, type Part } from "@google/genai"
import sharp from "sharp"
import type { ImageAI, ImageBytes, TryOnRequest } from "./types.js"

type Provider = { name: string; generate(req: TryOnRequest): Promise<ImageBytes> }

export type ImageOptions = {
  replicateToken?: string
  replicateImageModel: string
  replicateBgModel: string
  geminiKey?: string
  geminiImageModel?: string
  cloudflare?: CloudflareOptions
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
    usesReferences: !!((opts.geminiKey && opts.geminiImageModel) || opts.cloudflare),
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
      parts.push({ text: `${req.prompt} ${referenceNote(req)}`.trim() })
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

/** Tells an image model what each reference photo is (images numbered from 0) */
export function referenceNote(req: TryOnRequest) {
  if (req.mode === "studio") return ""
  const n = req.garments?.length ?? 0
  // with labels, each photo is named so the model knows which piece goes where (top over bottoms...)
  const which = req.labels?.length
    ? req.garments!.map((_, i) => `Image ${i} is the user's ${req.labels![i] ?? "garment"}.`).join(" ")
    : `${n === 1 ? "Image 0 is" : `Images 0 to ${n - 1} are`} the user's own clothes.`
  return [
    n ? `${which} Dress the person in exactly ${n === 1 ? "this piece" : "all of these pieces together, every one clearly visible"}, keeping their colours, wash, prints, details and cut.` : "",
    req.face ? `Image ${n} is the person's face: the person must look like them.` : "",
  ].join(" ").trim()
}

type CloudflareOptions = {
  accountId: string
  token: string
  /** text-only pictures */
  model: string
  /** edits from reference photos (studio photos, and try-ons unless tryOnModel is set) */
  editModel: string
  /** optional better model for try-ons; falls back to editModel when it fails (e.g. daily quota used up) */
  tryOnModel?: string
}

function cloudflare(cf: CloudflareOptions, http: typeof fetch): Provider {
  let queue: Promise<unknown> = Promise.resolve()
  const url = (model: string) => `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/run/${model}`
  const once = async (req: TryOnRequest, editModel: string) => {
    // FLUX.2 klein takes up to 4 reference photos; the face goes last
    const refs = [...(req.garments ?? []).slice(0, req.face ? 3 : 4), ...(req.face ? [req.face] : [])]
    let res: Response
    if (refs.length) {
      const form = new FormData()
      form.append("prompt", `${req.prompt} ${referenceNote({ ...req, garments: refs.slice(0, req.face ? -1 : undefined) })}`.trim().slice(0, 2000))
      // Workers AI rejects FLUX.2 reference photos of 512x512 or more, so phone photos are shrunk first
      const small = await Promise.all(refs.map((r) => fitReference(r)))
      small.forEach((r, i) => form.append(`input_image_${i}`, new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.contentType }), `ref${i}`))
      form.append("width", String(req.width ?? 768))
      form.append("height", String(req.height ?? 1024))
      res = await http(url(editModel), { method: "POST", headers: { Authorization: `Bearer ${cf.token}` }, body: form, signal: AbortSignal.timeout(120_000) })
    } else {
      res = await http(url(cf.model), {
        method: "POST",
        headers: { Authorization: `Bearer ${cf.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: req.prompt.slice(0, 2000), steps: 8, seed: Math.floor(Math.random() * 1e9) }),
        signal: AbortSignal.timeout(90_000),
      })
    }
    const body = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { message?: string }[] } | null
    const image = body?.result?.image
    if (!res.ok || !image) throw new Error(`HTTP ${res.status} ${body?.errors?.map((e) => e.message).join("; ") ?? ""}`)
    const bytes = new Uint8Array(Buffer.from(image, "base64"))
    return { bytes, contentType: bytes[0] === 0x89 ? "image/png" : "image/jpeg" }
  }
  return {
    name: "cloudflare",
    // one at a time keeps a burst (a new wardrobe) inside the free plan's rate limit
    generate(req) {
      const tryOn = !!cf.tryOnModel && req.mode !== "studio" && !!(req.garments?.length || req.face)
      const run = queue.then(() =>
        tryOn
          ? once(req, cf.tryOnModel!).catch((err: Error) => {
              console.warn(`[images] cloudflare ${cf.tryOnModel} failed, using ${cf.editModel}: ${err.message}`)
              return once(req, cf.editModel)
            })
          : once(req, cf.editModel),
      )
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

// "All input images must be smaller than 512x512" (Cloudflare's FLUX.2 docs)
export const MAX_REFERENCE_SIDE = 504

/** Shrinks a reference photo to fit inside MAX_REFERENCE_SIDE; cutouts keep their transparency */
export async function fitReference(img: ImageBytes): Promise<ImageBytes> {
  try {
    const pic = sharp(img.bytes).rotate()
    const meta = await pic.metadata()
    if (meta.width && meta.height && Math.max(meta.width, meta.height) <= MAX_REFERENCE_SIDE) return img
    const resized = pic.resize(MAX_REFERENCE_SIDE, MAX_REFERENCE_SIDE, { fit: "inside", withoutEnlargement: true })
    return meta.hasAlpha
      ? { bytes: new Uint8Array(await resized.png().toBuffer()), contentType: "image/png" }
      : { bytes: new Uint8Array(await resized.jpeg({ quality: 90 }).toBuffer()), contentType: "image/jpeg" }
  } catch {
    // not a picture sharp can read: send it as it is and let the provider decide
    return img
  }
}

/** Framing for the stylist's one-line picture prompts (recommendations, shopping, trends) */
export const editorial = (prompt: string) => `Editorial fashion photo, full body, natural light, plain city background. ${prompt}`
