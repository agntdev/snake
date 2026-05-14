/**
 * Database access layer.
 *
 * Why a thin abstraction:
 *   - The leaderboard backend talks to PostgreSQL via `pg`, but typechecking
 *     and unit tests must not require a running database. `getPool()` is lazy:
 *     a Pool is only constructed on first call.
 *   - Tests can swap in any object that implements the minimal `Db` interface
 *     below (e.g. `pg-mem`'s adapter) by calling `setDb()`.
 *   - All query helpers go through this module so the rest of the codebase
 *     never imports `pg` directly. Keeps the surface area small.
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Minimal subset of `pg.Pool` we depend on. */
export interface Db {
    query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
}

let _db: Db | null = null

/**
 * Returns the active database handle, lazily constructing a `pg.Pool` from
 * `DATABASE_URL` on first call. Throws if `DATABASE_URL` is not set and no
 * test harness has called `setDb()`.
 */
export async function getDb(): Promise<Db> {
    if (_db) return _db
    const url = process.env.DATABASE_URL
    if (!url) {
        throw new Error(
            'DATABASE_URL is not set. Either configure it, or call setDb() with a test adapter.',
        )
    }
    // Imported lazily so `pg` is not required for typecheck or tests that
    // never touch a real database.
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: url })
    _db = pool as unknown as Db
    return _db
}

/** Inject a custom adapter (e.g. pg-mem) for tests. */
export function setDb(db: Db | null): void {
    _db = db
}

/**
 * Apply every `.sql` file in `backend/migrations/` in lexicographic order.
 * Files are idempotent so re-running is safe.
 */
export async function runMigrations(db?: Db): Promise<void> {
    const handle = db ?? (await getDb())
    const here = dirname(fileURLToPath(import.meta.url))
    // src/ -> backend/migrations
    const migrationsDir = join(here, '..', 'migrations')
    const files = (await readdir(migrationsDir))
        .filter((f) => f.endsWith('.sql'))
        .sort()
    for (const file of files) {
        const sql = await readFile(join(migrationsDir, file), 'utf8')
        await handle.query(sql)
    }
}
