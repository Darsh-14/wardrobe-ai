// Claude adapter (paid: needs an Anthropic API key with billing). Use with AI_PROVIDER=claude.
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages"
import { AIError, SYSTEM, type Ask } from "./stylist.js"

export function claudeAsk(apiKey: string, model: string): Ask {
  const client = new Anthropic({ apiKey })
  return async (schema, prompt, depth) => {
    const content: BetaContentBlockParam[] = []
    if (prompt.image) {
      content.push({ type: "image", source: { type: "base64", media_type: prompt.image.mediaType, data: prompt.image.data } })
    }
    content.push({ type: "text", text: prompt.text })
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: depth === "light" ? "low" : "medium", format: betaZodOutputFormat(schema) },
      // if a safety classifier declines, the API retries on a fallback model in the same call
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    })
    if (res.stop_reason === "refusal") throw new AIError("The stylist declined this request")
    if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new AIError("The stylist returned no answer")
    return res.parsed_output as never
  }
}
