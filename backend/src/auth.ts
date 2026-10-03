// Login is Supabase Auth. The API verifies the Supabase access token on every request
// (Authorization: Bearer <token>) and also offers thin signup/login/refresh/logout endpoints so the
// frontend can sign in without bundling supabase-js.
import { createClient } from "@supabase/supabase-js"
import type { MiddlewareHandler } from "hono"
import { Hono } from "hono"
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose"
import { z } from "zod"
import type { Config } from "./config.js"
import { HttpError, parseBody } from "./http.js"

export type AuthUser = { id: string; email?: string; claims: JWTPayload }
export type AuthEnv = { Variables: { user: AuthUser } }

export function createVerifier(config: Config) {
  const secret = config.SUPABASE_JWT_SECRET ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET) : null
  const jwks = config.SUPABASE_URL
    ? createRemoteJWKSet(new URL(`${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
    : null

  return async function verify(token: string): Promise<AuthUser> {
    let payload: JWTPayload
    try {
      // Projects on the legacy shared secret sign with HS256; newer ones use asymmetric keys (JWKS)
      const alg = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString()).alg
      if (alg === "HS256" && secret) {
        payload = (await jwtVerify(token, secret, { audience: "authenticated" })).payload
      } else if (alg === "HS256" && config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
        // legacy shared-secret project without SUPABASE_JWT_SECRET set: let Supabase Auth check the token
        payload = await verifyWithSupabase(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, token)
      } else if (jwks) {
        payload = (await jwtVerify(token, jwks, { audience: "authenticated" })).payload
      } else {
        throw new Error("no key")
      }
    } catch {
      throw new HttpError(401, "Invalid or expired session")
    }
    if (!payload.sub) throw new HttpError(401, "Invalid session")
    return { id: payload.sub, email: payload.email as string | undefined, claims: payload }
  }
}

const sessionCache = new Map<string, { payload: JWTPayload; until: number }>()

async function verifyWithSupabase(url: string, apiKey: string, token: string): Promise<JWTPayload> {
  const hit = sessionCache.get(token)
  if (hit && hit.until > Date.now()) return hit.payload
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error("rejected")
  // Supabase accepted the token, so its claims can be read as they are
  const payload = decodeJwt(token)
  if (sessionCache.size > 1000) sessionCache.clear()
  sessionCache.set(token, { payload, until: Math.min(Date.now() + 60_000, (payload.exp ?? 0) * 1000) })
  return payload
}

export function requireAuth(verify: ReturnType<typeof createVerifier>): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : ""
    if (!token) throw new HttpError(401, "Sign in required")
    c.set("user", await verify(token))
    await next()
  }
}

const Credentials = z.object({ email: z.email(), password: z.string().min(6) })
const Signup = Credentials.extend({
  name: z.string().trim().min(1).max(80).optional(),
  city: z.string().trim().min(1).max(80).optional(),
})

export function authRoutes(config: Config) {
  const app = new Hono()
  const client = () => {
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      throw new HttpError(501, "Auth endpoints need SUPABASE_URL and SUPABASE_ANON_KEY")
    }
    return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  const toSession = (s: { access_token: string; refresh_token: string; expires_at?: number } | null) =>
    s && { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at ?? null }

  app.post("/signup", async (c) => {
    const body = await parseBody(c, Signup)
    const { data, error } = await client().auth.signUp({
      email: body.email,
      password: body.password,
      // the signup trigger copies name and city into profiles
      options: { data: { name: body.name ?? "", city: body.city ?? null } },
    })
    if (error) throw new HttpError(error.status ?? 400, error.message)
    // With email confirmation on, Supabase returns no session until the link is clicked
    return c.json({ userId: data.user?.id, session: toSession(data.session), needsEmailConfirmation: !data.session }, 201)
  })

  app.post("/login", async (c) => {
    const body = await parseBody(c, Credentials)
    const { data, error } = await client().auth.signInWithPassword(body)
    if (error) throw new HttpError(401, error.message)
    return c.json({ userId: data.user.id, session: toSession(data.session) })
  })

  app.post("/refresh", async (c) => {
    const body = await parseBody(c, z.object({ refreshToken: z.string().min(1) }))
    const { data, error } = await client().auth.refreshSession({ refresh_token: body.refreshToken })
    if (error || !data.session) throw new HttpError(401, error?.message ?? "Session expired")
    return c.json({ session: toSession(data.session) })
  })

  app.post("/logout", async (c) => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer /, "")
    if (token && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      // revokes the refresh token; the access token stays valid until it expires (default 1h)
      await admin.auth.admin.signOut(token)
    }
    return c.body(null, 204)
  })

  return app
}
