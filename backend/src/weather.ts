// Weather for the top bar, home card and look generation. Uses Open-Meteo (free, no API key), falls
// back to wttr.in (also free) when Open-Meteo fails, and caches current conditions per city in
// weather_cache for 30 minutes.
import type { Db } from "./db.js"

export type Weather = { tempC: number; condition: string; advice: string }

const CACHE_MINUTES = 30

const WMO: [number[], string][] = [
  [[0], "Clear"],
  [[1], "Mostly clear"],
  [[2], "Partly cloudy"],
  [[3], "Overcast"],
  [[45, 48], "Foggy"],
  [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain"],
  [[71, 73, 75, 77, 85, 86], "Snow"],
  [[95, 96, 99], "Thunderstorms"],
]

export function describe(code: number): string {
  return WMO.find(([codes]) => codes.includes(code))?.[1] ?? "Mixed"
}

export function adviceFor(tempC: number, condition: string): string {
  if (/rain|drizzle|thunder/i.test(condition)) return "Carry a layer you don't mind getting wet"
  if (/snow/i.test(condition)) return "Warm layers and waterproof shoes"
  if (tempC <= 8) return "Bundle up with a warm coat"
  if (tempC <= 16) return "Layer up with a jacket"
  if (tempC <= 24) return "Light layers recommended"
  if (tempC <= 30) return "Breathable fabrics recommended"
  return "Keep it light and airy"
}

export interface WeatherService {
  /** Current weather, or the forecast for `at` when it is within the next 15 days. */
  get(location: string, at?: Date): Promise<Weather>
}

export function createWeather(db: Db, provider: "open-meteo" | "mock"): WeatherService {
  if (provider === "mock") {
    return { get: async () => ({ tempC: 22, condition: "Partly cloudy", advice: "Light layers recommended" }) }
  }

  const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(8000) })

  async function geocode(location: string) {
    // "Hauz Khas, New Delhi" -> try the whole string, then the last part ("New Delhi")
    const parts = location.split(",").map((s) => s.trim()).filter(Boolean)
    for (const name of [location, ...parts.reverse()]) {
      const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`
      const res = await get(url)
      if (!res.ok) throw new Error(`Location service returned ${res.status}`)
      const hit = (await res.json()).results?.[0]
      if (hit) return { lat: hit.latitude as number, lon: hit.longitude as number }
    }
    throw new Error(`Unknown location: ${location}`)
  }

  async function fetchWeather(location: string, at?: Date): Promise<Weather> {
    const { lat, lon } = await geocode(location)
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&forecast_days=16&timezone=UTC`
    const res = await get(url)
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
    const data = await res.json()
    let temp: number = data.current.temperature_2m
    let code: number = data.current.weather_code
    if (at) {
      const hour = at.toISOString().slice(0, 13) + ":00"
      const i = (data.hourly.time as string[]).indexOf(hour)
      if (i >= 0) {
        temp = data.hourly.temperature_2m[i]
        code = data.hourly.weather_code[i]
      }
    }
    const condition = describe(code)
    return { tempC: Math.round(temp), condition, advice: adviceFor(temp, condition) }
  }

  // Current conditions only; used when Open-Meteo is down or rate limits the host's shared IP.
  async function fetchWttr(location: string): Promise<Weather> {
    const res = await get(`https://wttr.in/${encodeURIComponent(location)}?format=j1`)
    if (!res.ok) throw new Error(`Backup weather service returned ${res.status}`)
    const now = (await res.json()).current_condition?.[0]
    const temp = Number(now?.temp_C)
    if (!now || !Number.isFinite(temp)) throw new Error(`Unknown location: ${location}`)
    const text: string = now.weatherDesc?.[0]?.value ?? ""
    const condition =
      /thunder/i.test(text) ? "Thunderstorms" : /snow|sleet|blizzard|ice/i.test(text) ? "Snow"
      : /drizzle/i.test(text) ? "Drizzle" : /rain|shower/i.test(text) ? "Rain"
      : /fog|mist|haze/i.test(text) ? "Foggy" : /overcast/i.test(text) ? "Overcast"
      : /cloud/i.test(text) ? "Partly cloudy" : /clear|sunny/i.test(text) ? "Clear" : "Mixed"
    return { tempC: Math.round(temp), condition, advice: adviceFor(temp, condition) }
  }

  async function fetchAny(location: string, at?: Date): Promise<Weather> {
    try {
      return await fetchWeather(location, at)
    } catch (err) {
      console.warn(`Open-Meteo failed for "${location}": ${(err as Error).message}; trying wttr.in`)
      try {
        return await fetchWttr(location)
      } catch (err2) {
        console.warn(`wttr.in failed for "${location}": ${(err2 as Error).message}`)
        throw err
      }
    }
  }

  return {
    async get(location, at) {
      const key = location.trim().toLowerCase()
      const future = at && at.getTime() - Date.now() > 60 * 60 * 1000
      if (!future) {
        const [hit] = await db.sql`select data from weather_cache
                                   where city_key = ${key} and fetched_at > now() - make_interval(mins => ${CACHE_MINUTES})`
        if (hit) return hit.data as Weather
      }
      const weather = await fetchAny(location, future ? at : undefined)
      if (!future) {
        await db.sql`insert into weather_cache (city_key, data) values (${key}, ${db.sql.json(weather)})
                     on conflict (city_key) do update set data = excluded.data, fetched_at = now()`
      }
      return weather
    },
  }
}
