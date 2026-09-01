#!/usr/bin/env node
/**
 * Fail when `schema.prisma` and the migration history disagree.
 *
 * ## Why this is a check and not a paragraph
 *
 * CLAUDE.md carried a note for months saying this repository HAD schema drift,
 * and that therefore new migrations had to be hand-written. It stopped being
 * true long before the note did, and the note's own correction says what that
 * cost: "this note claimed the opposite for months after it stopped being true
 * and cost a design decision."
 *
 * A documented fact about the code rots. A check cannot. Once this runs in CI
 * the paragraph shrinks to a sentence pointing here, and nobody has to trust a
 * measurement somebody took in August.
 *
 * ## Why the shadow database, rather than the developer's own
 *
 * `--from-schema-datasource` would compare `schema.prisma` against whatever
 * database happens to be connected — which answers a different and much weaker
 * question. Measured while writing this: a dev database still carrying another
 * branch's migrations reported 22 statements of "drift" that were nothing but
 * a branch switch.
 *
 * `--from-migrations` replays the migration folder into a scratch database
 * instead, so the answer depends only on the two things being compared. That
 * is what makes it safe to run anywhere, on any branch, at any time.
 *
 * ## What a failure means
 *
 * `prisma migrate dev` would fold unrelated schema changes into whatever
 * migration you generate next. Fix it by generating the missing migration
 * BEFORE writing the one you actually wanted, so the two do not travel
 * together and become impossible to review apart.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "backend",
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. This check needs a Postgres server to replay into.",
  );
  process.exit(2);
}

/**
 * The scratch database. Derived rather than configured, so a developer never
 * has to set a second variable — but overridable, because a shared CI server
 * may not grant CREATE DATABASE.
 */
const shadowUrl =
  process.env.SHADOW_DATABASE_URL ??
  `${databaseUrl.replace(/\/[^/?]+(\?|$)/, "/")}travstats_drift_shadow`;

const prisma = (args, opts = {}) =>
  spawnSync("npx", ["prisma", ...args], {
    cwd: BACKEND,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });

// Create the scratch database if it is not there yet. An "already exists"
// error is the expected steady state and must not fail the check — which is
// why the result is inspected rather than the exit code trusted.
const maintenanceUrl = databaseUrl.replace(/\/[^/?]+(\?|$)/, "/") + "postgres";
const dbName = shadowUrl
  .slice(shadowUrl.lastIndexOf("/") + 1)
  .replace(/\?.*$/, "");
const created = prisma(["db", "execute", "--url", maintenanceUrl, "--stdin"], {
  input: `CREATE DATABASE "${dbName}"`,
});
const createOutput = `${created.stdout ?? ""}${created.stderr ?? ""}`;
if (created.status !== 0 && !/already exists/i.test(createOutput)) {
  console.error(
    `Could not provision the shadow database "${dbName}":\n${createOutput.trim()}`,
  );
  console.error(
    "Set SHADOW_DATABASE_URL to a database this user may write to.",
  );
  process.exit(2);
}

const diff = prisma([
  "migrate",
  "diff",
  "--from-migrations",
  "prisma/migrations",
  "--to-schema-datamodel",
  "prisma/schema.prisma",
  "--shadow-database-url",
  shadowUrl,
  "--script",
  "--exit-code",
]);

// Prisma's contract: 0 = no difference, 2 = a difference, anything else is a
// failure to answer. The third case must not be reported as "no drift".
if (diff.status === 0) {
  console.log("Schema and migration history agree.");
  process.exit(0);
}

if (diff.status === 2) {
  console.error("DRIFT: schema.prisma and prisma/migrations disagree.\n");
  console.error("The migration that would close the gap:\n");
  console.error(diff.stdout);
  console.error(
    "\nGenerate this as its own migration before writing the one you meant to write —\n" +
      "otherwise the two travel together and cannot be reviewed apart.",
  );
  process.exit(1);
}

console.error(`prisma migrate diff could not answer (exit ${diff.status}):`);
console.error(`${diff.stdout ?? ""}${diff.stderr ?? ""}`);
process.exit(2);
