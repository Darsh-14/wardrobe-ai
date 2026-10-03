// Google Gemini adapter (default, AI_PROVIDER=gemini). The Gemini API has a free tier: create a key
// at https://aistudio.google.com/apikey with no billing set up. Free-tier limits are per minute and per
// day, and Google may use free-tier prompts to improve its products.
import { ApiError, GoogleGenAI, ThinkingLevel, type Part } from "@google/genai"
import { z } from "zod"
import { HttpError } from "../http.js"
import { AIError, SYSTEM, type Ask } from "./stylist.js"

export let RETRY_MS = 5000
export const setRetryDelay = (ms: number) => (RETRY_MS = ms)

// A model that is overloaded (503), rate limited (429) or retired for this key (404)
const isBusy = (err: unknown) => err instanceof ApiError && [404, 429, 503].includes(err.status)

/**
 * `models` is tried in order: when one is busy (free-tier keys hit this often) the next one answers.
 * If every model is busy, the first is retried once after a short wait.
 */
export function geminiAsk(apiKey: string, models: string | string[], baseUrl?: string): Ask {
  const client = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) })
  const chain = (Array.isArray(models) ? models : [models]).filter(Boolean)

  return async (schema, prompt, depth) => {
    const parts: Part[] = []
    if (prompt.image) parts.push({ inlineData: { data: prompt.image.data, mimeType: prompt.image.mediaType } })
    parts.push({ text: prompt.text })

    const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>
    const request = (model: string) =>
      client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          // quick tagging doesn't need the model to think much (2.5 models take a budget, 3.x a level)
          ...(depth === "light"
            ? { thinkingConfig: model.includes("2.5") ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      })

    let res
    let lastErr: unknown
    for (const model of [...chain, chain[0]]) {
      if (model === chain[0] && lastErr) await new Promise((r) => setTimeout(r, RETRY_MS))
      try {
        res = await request(model)
        break
      } catch (err) {
        if (!isBusy(err)) throw err
        console.warn(`[gemini] ${model} busy (${(err as ApiError).status}), trying the next model`)
        lastErr = err
      }
    }
    if (!res) throw new HttpError(503, "The AI stylist is busy right now. Try again in a minute.")

    const text = res.text
    if (!text) throw new AIError(`The stylist returned no answer (${res.candidates?.[0]?.finishReason ?? "blocked"})`)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new AIError("The stylist returned malformed JSON")
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new AIError(`The stylist's answer didn't match the expected shape: ${parsed.error.message}`)
    return parsed.data
  }
}
