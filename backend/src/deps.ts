import type { ImageAI, StylistAI } from "./ai/types.js"
import type { Config } from "./config.js"
import type { Db } from "./db.js"
import type { Storage } from "./storage.js"
import type { WeatherService } from "./weather.js"

export type Deps = {
  config: Config
  db: Db
  storage: Storage
  stylist: StylistAI
  images: ImageAI
  weather: WeatherService
  jobs: Jobs
}

// Slow work (image generation) runs after the response is sent. In-process is enough for one
// instance; move to a queue (pg-boss, Supabase queues) when running several.
export class Jobs {
  private running = new Set<Promise<unknown>>()
  run(name: string, fn: () => Promise<unknown>) {
    const p = fn()
      .catch((err) => console.error(`[job ${name}]`, err))
      .finally(() => this.running.delete(p))
    this.running.add(p)
  }
  /** Resolves when all queued jobs are done (tests, graceful shutdown). */
  async idle() {
    while (this.running.size) await Promise.all([...this.running])
  }
}
