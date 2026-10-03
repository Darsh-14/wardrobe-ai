// Postgres access. Every user request runs inside a transaction as the `authenticated` role with
// the caller's JWT claims set, exactly like Supabase's own API does, so the RLS policies in
// db/migrations/0003_rls.sql decide what each user can read and write.
// `asService` runs as the connection's own role (bypasses RLS) and is only for AI jobs that
// write results, trends and the weather cache.
import postgres from "postgres"

export type Tx = postgres.TransactionSql
export type Db = ReturnType<typeof createDb>

export function createDb(url: string) {
  const sql = postgres(url, {
    // Supabase's transaction pooler does not support prepared statements
    prepare: false,
    max: 10,
    idle_timeout: 30,
    transform: { undefined: null },
    types: {
      // return numeric/bigint as JS numbers (counts and prices here are small)
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  })

  return {
    sql,
    asUser<T>(userId: string, claims: Record<string, unknown>, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return sql.begin(async (tx) => {
        const json = JSON.stringify({ ...claims, sub: userId, role: "authenticated" })
        await tx`select set_config('role', 'authenticated', true),
                        set_config('request.jwt.claims', ${json}, true),
                        set_config('request.jwt.claim.sub', ${userId}, true)`
        return fn(tx)
      }) as Promise<T>
    },
    asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return sql.begin((tx) => fn(tx)) as Promise<T>
    },
    end: () => sql.end({ timeout: 5 }),
  }
}
