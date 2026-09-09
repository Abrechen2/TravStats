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
/**
 * Refuse to run against a database this suite must not destroy.
 *
 * The suites here are destructive by design: `auth.test.ts` alone calls
 * `user.deleteMany()` with no filter, and User carries a wide fan of
 * `onDelete: Cascade` relations, so one run against the wrong URL takes every
 * account and every trip with it. Until 2026-09-09 the only thing standing
 * between `npm test` and that was the author remembering which DATABASE_URL was
 * exported (audit finding AUD-001).
 *
 * The check is deliberately in two parts, because the two risks are not equal.
 *
 * A REMOTE host is refused outright, with no way to override. Prod, the RC and
 * the Beta all live on other machines, and no correct test run has ever needed
 * to reach across the network — so this is not a warning, it is a wall. Docker
 * hostnames are refused by the same rule: `db`, `travstats-db` and friends are
 * not loopback.
 *
 * A LOCAL database is allowed when its name is one this project already treats
 * as expendable, and otherwise needs `TRAVSTATS_ALLOW_DESTRUCTIVE_TESTS=1`.
 * `flights_dev` is knowingly on that list: the documented workflow runs the
 * suite against it, the dev seed is rebuilt with `npm run seed:dev-admin`, and
 * pretending otherwise would only teach everyone to set the override
 * permanently — which is how a guard stops guarding.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

/** Databases whose contents this project already treats as rebuildable. */
const EXPENDABLE_DB_NAMES = new Set(["flights_dev", "travstats_dev"]);
const EXPENDABLE_DB_SUFFIXES = ["_test", "_tests", "_audit"];

function assertDatabaseIsExpendable(url: string): void {
  let parsed: URL;
  try {
    // The postgresql:// scheme parses fine as a URL; only the shape is needed.
    parsed = new URL(url);
  } catch {
    // An unparseable URL is not a licence to proceed — the connection attempt
    // below would fail anyway, and guessing here would be the wrong instinct.
    return;
  }

  const host = parsed.hostname.toLowerCase();
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const shown = url.replace(/\/\/[^@]*@/, "//***:***@");

  if (!LOCAL_HOSTS.has(host)) {
    process.stderr.write(
      [
        "",
        "  REFUSED: the backend test suite is destructive and this database is not local.",
        "",
        `    DATABASE_URL : ${shown}`,
        `    host         : ${host}`,
        "",
        "  These tests delete every user and cascade through their data. Prod, the",
        "  RC and the Beta are all remote, so a remote host here is never right and",
        "  there is no override for it. Point DATABASE_URL at a local database.",
        "",
      ].join("\n")
    );
    process.exit(1);
  }

  const expendable =
    EXPENDABLE_DB_NAMES.has(name) ||
    EXPENDABLE_DB_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    process.env.TRAVSTATS_ALLOW_DESTRUCTIVE_TESTS === "1";

  if (!expendable) {
    process.stderr.write(
      [
        "",
        "  REFUSED: this database is local, but nothing marks it as one to destroy.",
        "",
        `    DATABASE_URL : ${shown}`,
        `    database     : ${name}`,
        "",
        "  The suite empties tables outright. Either point it at a database whose",
        `  name ends in ${EXPENDABLE_DB_SUFFIXES.join(", ")} (or is one of`,
        `  ${[...EXPENDABLE_DB_NAMES].join(", ")}), or say so on purpose:`,
        "",
        "    TRAVSTATS_ALLOW_DESTRUCTIVE_TESTS=1 npm test",
        "",
      ].join("\n")
    );
    process.exit(1);
  }
}

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The backend suite needs Postgres — see CONTRIBUTING/backend README."
    );
  }

  assertDatabaseIsExpendable(url);

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
