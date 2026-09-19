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
import { PrismaClient, type Prisma } from "./prisma";

export interface PrismaClientOptions {
  /** Defaults to `process.env.DATABASE_URL`. */
  url?: string;
  log?: Prisma.PrismaClientOptions["log"];
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
  const adapter = new PrismaPg(
    limit ? { connectionString, max: Number(limit[1]) } : { connectionString }
  );
  return options.log
    ? new PrismaClient({ adapter, log: options.log })
    : new PrismaClient({ adapter });
}
