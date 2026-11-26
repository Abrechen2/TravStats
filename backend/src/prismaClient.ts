/**
 * How a Prisma client is built in this project, in one place.
 *
 * Prisma 7 is Rust-free: there is no query engine left to hand a connection
 * string to, so `new PrismaClient()` without a driver adapter no longer
 * compiles, let alone runs. Eighteen call sites — the singleton, `init.ts`,
 * every seed, every backfill script, the drift check and the Jest global
 * setup — each construct their own client, and none of them should have to
 * know that the pool is a `pg.Pool` or how the connection limit is spelled.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolConfig } from "pg";
import { PrismaClient, type Prisma } from "./prisma";
import { poolTimeoutConfig, type SessionTimeouts } from "./services/db/sessionTimeouts";

export interface PrismaClientOptions {
  /** Defaults to `process.env.DATABASE_URL`. */
  url?: string;
  log?: Prisma.PrismaClientOptions["log"];
  /**
   * Per-session statement and idle-in-transaction timeouts. Only the app's
   * singleton passes them; seeds, backfills and the drift check keep the
   * server default, since they run long statements on purpose.
   */
  sessionTimeouts?: SessionTimeouts;
  /**
   * Build the `pg.Pool` here instead of inside the adapter, so the admin
   * runtime card can read its counters (`appPoolStats`). Only the app's
   * singleton does; the pool lets the process exit while idle, as the
   * adapter's own pool did when the client disconnected.
   */
  observePool?: boolean;
}

/** pg's default pool size, which applies when the URL names no connection_limit. */
const PG_DEFAULT_POOL_MAX = 10;

let observedPool: Pool | null = null;

export interface PoolStats {
  max: number;
  total: number;
  idle: number;
  waiting: number;
}

/** The app pool's counters, or null when no observed pool exists (scripts, tests with their own client). */
export function appPoolStats(): PoolStats | null {
  if (!observedPool) return null;
  return {
    max: observedPool.options.max ?? PG_DEFAULT_POOL_MAX,
    total: observedPool.totalCount,
    idle: observedPool.idleCount,
    waiting: observedPool.waitingCount,
  };
}

/**
 * `connection_limit` is Prisma's own spelling of the pool size and `pg` has
 * never understood it: left in the connection string it is silently ignored
 * and the pool falls back to `pg`'s default of 10. That is not a detail here.
 * `jest.setup.ts` appends `connection_limit=5` deliberately, because an
 * oversized pool against a shared Postgres has cost this project several
 * debugging sessions — the symptom is three figures of timeouts and `40P01`
 * deadlocks that read like broken code rather than a starved pool. So the
 * parameter is translated rather than passed through.
 */
export function createPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  const connectionString = options.url ?? process.env.DATABASE_URL ?? "";
  const limit = /[?&]connection_limit=(\d+)/.exec(connectionString);
  const timeouts = options.sessionTimeouts ? poolTimeoutConfig(options.sessionTimeouts) : {};
  const config: PoolConfig = {
    connectionString,
    ...(limit ? { max: Number(limit[1]) } : {}),
    ...timeouts,
  };
  let adapter: PrismaPg;
  if (options.observePool) {
    const pool = new Pool({ ...config, allowExitOnIdle: true });
    observedPool = pool;
    adapter = new PrismaPg(pool);
  } else {
    adapter = new PrismaPg(config);
  }
  return options.log
    ? new PrismaClient({ adapter, log: options.log })
    : new PrismaClient({ adapter });
}
