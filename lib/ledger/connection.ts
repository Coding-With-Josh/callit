/**
 * ledger/connection — the single Postgres connection for Callit's own data.
 *
 * Owns: resolving the connection string, a process-wide pooled client, and the
 * `sql` tagged-template helper used by the ledger modules.
 * Must not import: adapters, React, Next.
 *
 * Why this exists (found during the Blink review): `lib/ledger/db.ts` imported
 * `sql` straight from `@vercel/postgres`, which reads `POSTGRES_URL` — a var this
 * repo does not set. With only `DATABASE_URL` present those queries throw
 * "no connectionString was found", so the ledger was quietly unusable. This
 * module reads `DATABASE_URL` (the var the project actually documents) and falls
 * back to `POSTGRES_URL` so either works.
 *
 * Phase 2 (fail-closed + bounded): a missing connection string returns null from
 * `getLedgerPool`, and `query` throws rather than silently no-op'ing — callers
 * translate that into a deny (never a silent success). Every query is bounded by
 * `statement_timeout`/`query_timeout` so a hung database degrades as a timeout
 * instead of pinning a serverless request open.
 */
import { Pool, type QueryResultRow } from 'pg';

/** Cached across HMR/dev reloads so we do not leak a pool per module instance. */
const globalForLedger = globalThis as unknown as {
  __callitLedgerPool?: Pool;
};

/** The connection string, or null when the deploy has no database configured. */
export function ledgerConnectionString(): string | null {
  const raw = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  return raw !== undefined && raw.length > 0 ? raw : null;
}

/** True when a database is configured. Routes use this to fail closed to 503. */
export function isLedgerConfigured(): boolean {
  return ledgerConnectionString() !== null;
}

/** The shared pool, or null when no database is configured. */
export function getLedgerPool(): Pool | null {
  const connectionString = ledgerConnectionString();
  if (connectionString === null) return null;
  const existing = globalForLedger.__callitLedgerPool;
  if (existing !== undefined) return existing;

  const pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });
  // An idle client dropping (Neon/Vercel scale-to-zero) emits 'error'; without a
  // listener Node treats it as an unhandled event and can kill the process.
  pool.on('error', () => {});
  globalForLedger.__callitLedgerPool = pool;
  return pool;
}

/** Run one parameterized query and return its rows. Throws when unconfigured. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const pool = getLedgerPool();
  if (pool === null) {
    throw new Error('ledger database is not configured');
  }
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

/**
 * Tagged-template wrapper so `lib/ledger/db.ts` keeps its call style while
 * actually connecting. Values are bound as `$1..$n` — never interpolated into
 * the SQL text (Phase 3: SQL injection).
 */
export async function sql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<{ rows: T[] }> {
  let text = '';
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i] ?? '';
    if (i < values.length) text += `$${i + 1}`;
  }
  const rows = await query<T>(text, values);
  return { rows };
}
