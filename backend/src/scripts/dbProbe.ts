/**
 * The two database questions the Docker entrypoint asks, as a compiled script.
 *
 * They used to be `node -e "const {PrismaClient}=require('@prisma/client'); …"`
 * one-liners inside `docker-entrypoint.sh`. Prisma 7 ended that: a client now
 * needs a driver adapter, so the one-liner would have to build a `PrismaPg`
 * too — and the whole point of `src/prismaClient.ts` is that exactly one place
 * knows how a client is made. A shell string is also the one place in this
 * repository nothing type-checks.
 *
 * Prints a single word on stdout, because that is what the entrypoint greps
 * for: `ok` or `fail`. It never exits non-zero — a probe that killed the
 * container would turn "the database is not up yet" into "the image is
 * broken", and the entrypoint already decides what to do with a `fail`.
 *
 *   node dist/scripts/dbProbe.js                    → can we reach the database
 *   node dist/scripts/dbProbe.js migrations-table   → did migrations ever run
 */
import { createPrismaClient } from "../prismaClient";

async function main(): Promise<void> {
  const probe = process.argv[2] ?? "connect";
  const prisma = createPrismaClient();
  try {
    if (probe === "migrations-table") {
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`;
      process.stdout.write(rows.length > 0 ? "ok\n" : "fail\n");
    } else {
      // A real query, not `$connect()`: with a driver adapter the pool is lazy,
      // so connecting proves less than it used to.
      await prisma.$queryRaw`SELECT 1`;
      process.stdout.write("ok\n");
    }
  } catch {
    process.stdout.write("fail\n");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
