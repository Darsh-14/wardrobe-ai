// Image generation (look visualizations) and background removal (wardrobe cutouts) via Replicate.
// Both model names are configurable; with no REPLICATE_API_TOKEN these return null and callers
// fall back to the original photos.
import type { ImageAI } from "./types.js"

export function createImageAI(opts: { token?: string; imageModel: string; bgModel: string }): ImageAI {
  if (!opts.token) {
    return { enabled: false, generate: async () => null, removeBackground: async () => null }
  }

  async function run(model: string, input: Record<string, unknown>) {
    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({ input }),
    })
    let prediction = await res.json()
    if (!res.ok) throw new Error(`Replicate ${model}: ${res.status} ${prediction?.detail ?? ""}`)
    // Prefer: wait returns early for slow models; poll until done
    for (let i = 0; i < 60 && !["succeeded", "failed", "canceled"].includes(prediction.status); i++) {
      await new Promise((r) => setTimeout(r, 2000))
      prediction = await (await fetch(prediction.urls.get, { headers: { Authorization: `Bearer ${opts.token}` } })).json()
    }
    if (prediction.status !== "succeeded") throw new Error(`Replicate ${model}: ${prediction.status} ${prediction.error ?? ""}`)
    const url: string = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
    const file = await fetch(url)
    if (!file.ok) throw new Error(`Replicate output download failed: ${file.status}`)
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.headers.get("content-type") ?? "image/webp",
    }
  }

  return {
    enabled: true,
    generate: (prompt) =>
      run(opts.imageModel, {
        prompt: `Editorial fashion photo, full body, natural light, plain city background. ${prompt}`,
        aspect_ratio: "3:4",
        output_format: "webp",
      }),
    removeBackground: (imageUrl) => run(opts.bgModel, { image: imageUrl }),
  }
}
