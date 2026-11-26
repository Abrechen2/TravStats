/**
 * Per-session Postgres timeouts for the app's pool (perf audit 2026-11,
 * item 13). Both were 0 on prod: one runaway query or a hung interactive
 * transaction could hold locks and the xmin horizon (so autovacuum) forever.
 *
 * The pool sets them once per connection; a job known to run long statements
 * raises its own limit inside its transaction with `SET LOCAL`, so the raise
 * ends with that transaction and never leaks onto a pooled connection.
 * Migrations (`prisma migrate deploy`), `pg_dump` and the `psql` restore open
 * their own connections and are not affected.
 */

/** Per statement, unless the job raised it. `DB_STATEMENT_TIMEOUT_MS`, 0 = off. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
/** An open transaction that sends nothing for this long is ended. 0 = off. */
export const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 5 * 60_000;

/**
 * Jobs whose single statements can outlast the default, with the limit they
 * raise to. A whole-account delete cascades through ~1.7M TravTrack rows on
 * the owner's account in ONE statement; an archive restore's id-remap and
 * bulk-insert statements grow with the account. Exports (`rowReader.ts`) and
 * file imports (`importPacing.ts`) already work in small keyset pages and
 * batches, so they stay inside the default and need no raise.
 */
export const LONG_JOB_STATEMENT_TIMEOUT_MS = {
  accountDeletion: 30 * 60_000,
  archiveRestore: 10 * 60_000,
} as const;

export type LongJob = keyof typeof LONG_JOB_STATEMENT_TIMEOUT_MS;

export interface SessionTimeouts {
  statementTimeoutMs: number;
  idleInTransactionMs: number;
}

function parseMs(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a whole number of milliseconds (0 = off), got "${raw}"`);
  }
  return n;
}

/** The pool's timeouts from the environment; a malformed value fails the boot loudly. */
export function sessionTimeoutsFromEnv(env: NodeJS.ProcessEnv = process.env): SessionTimeouts {
  return {
    statementTimeoutMs: parseMs(
      env.DB_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      "DB_STATEMENT_TIMEOUT_MS"
    ),
    idleInTransactionMs: parseMs(
      env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      "DB_IDLE_IN_TRANSACTION_TIMEOUT_MS"
    ),
  };
}

/** The `pg.PoolConfig` fields; 0 leaves the server default (off). */
export function poolTimeoutConfig(t: SessionTimeouts): {
  statement_timeout?: number;
  idle_in_transaction_session_timeout?: number;
} {
  return {
    ...(t.statementTimeoutMs > 0 ? { statement_timeout: t.statementTimeoutMs } : {}),
    ...(t.idleInTransactionMs > 0
      ? { idle_in_transaction_session_timeout: t.idleInTransactionMs }
      : {}),
  };
}

interface RawExecutor {
  $executeRawUnsafe(query: string): Promise<unknown>;
}

/**
 * Raises the statement timeout for the rest of THIS transaction. Must be
 * called on a transaction client: outside one, `SET LOCAL` is a no-op with a
 * warning, which is the safe failure (the default stays).
 */
export async function raiseStatementTimeout(tx: RawExecutor, job: LongJob): Promise<void> {
  const ms = LONG_JOB_STATEMENT_TIMEOUT_MS[job];
  // A constant from the table above, never user input.
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.floor(ms)}`);
}
