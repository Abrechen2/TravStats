import { PrismaClient } from "@prisma/client";

/**
 * One reachable database, or one clear sentence — never a thousand assertions.
 *
 * Almost every suite here talks to Postgres. When it is not there, each test
 * fails on its own expectation, and the run ends with a four-figure failure
 * count that reads like the code broke. On 2026-08-30 that produced 1010
 * "failures" against a port with nothing behind it, and the number was believed
 * long enough to matter.
 *
 * The check is a real query rather than an open port: a listening socket proves
 * nothing about the database existing or the credentials being accepted, and
 * both of those fail in exactly the same confusing way.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The backend suite needs Postgres — see CONTRIBUTING/backend README."
    );
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    // Never print the URL itself: it carries the password.
    const shown = url.replace(/\/\/[^@]*@/, "//***:***@");
    // Prisma opens with a blank line and then "Invalid `prisma.x()`
    // invocation:", which says nothing about the cause. The sentence worth
    // printing is the one after that — "Can't reach database server at …",
    // "Authentication failed …", "database … does not exist".
    const reason =
      (error instanceof Error ? error.message : String(error))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.endsWith("invocation:")) ?? "unknown error";
    process.stderr.write(
      [
        "",
        "  The backend test suite cannot reach its database.",
        "",
        `    DATABASE_URL : ${shown}`,
        `    reason       : ${reason}`,
        "",
        "  Nothing was run. Start the dev database and try again:",
        "",
        "    docker start travstats-db-dev",
        "",
        "  A wrong port here does not look like a connection problem — every",
        "  test fails on its own expectation instead, so fix this before",
        "  reading any failure count.",
        "",
      ].join("\n")
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
