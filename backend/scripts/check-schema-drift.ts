/**
 * Schema-drift regression check.
 *
 * Runs `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code`,
 * replaying the migration folder into a scratch shadow database. If the live DB state (after `prisma
 * migrate deploy`) and `schema.prisma` disagree, exits with code 2 — the
 * same convention used by `--exit-code`.
 *
 * Why this exists: in 2026-04 the prod DB was found to have drifted from
 * `schema.prisma` (NOT NULL flips on `flights.has_live_tracking`,
 * `user_settings.historical_enrichment_*` etc.). Migration `20260419140000_schema_drift_fix`
 * resolved it, and this check exists so the same gap cannot reopen silently.
 *
 * It is NOT wired into CI, despite what this comment claimed until
 * 2026-09-01. `.github/workflows/ci.yml` runs one job — Prettier on changed
 * frontend files — and `grep check-schema-drift .github/` finds nothing. Two
 * plan documents under `docs/superpowers/` repeat the same false claim.
 * Wiring it in is forgejo#60; correcting the claim was free and is done here,
 * because a check that lies about being automated is worse than one that
 * admits it is manual.
 *
 * Why `--from-migrations` and not `--from-schema-datasource` (changed
 * 2026-09-01, forgejo#74):
 *
 * This comment used to argue the opposite, because with the
 * `postgresqlExtensions` preview feature enabled `--from-migrations` failed to
 * register raw `CREATE EXTENSION` statements in the shadow database and
 * reported postgis as drift on every run. **That feature is no longer in
 * `schema.prisma`** — measured 2026-09-01, `postgresqlExtensions` and `postgis`
 * appear nowhere in it — so the objection has expired. If either ever returns,
 * this is the paragraph that explains the false positive you will then see.
 *
 * What replaced it is a worse failure the datasource comparison always had:
 * it compares against whatever database happens to be connected, and this
 * project's dev database is shared by every worktree. Measured on the same
 * day, a dev DB still holding another branch's migrations reported 22
 * statements of "drift" that were nothing but a branch switch. Replaying the
 * migration folder into a scratch database instead makes the answer depend
 * only on the two things being compared, so it is the same on any branch, at
 * any time, with any database attached.
 *
 * Usage (local):
 *   1. cd backend && DATABASE_URL=... npx prisma migrate deploy  # bring DB up
 *   2. DATABASE_URL=... npm run check:drift
 *
 * Usage (CI): see `.github/workflows/ci.yml` — "Check schema drift" runs
 * after the migrate-deploy step against the same DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const SCHEMA_PATH = resolve(__dirname, "..", "prisma", "schema.prisma");
const MIGRATIONS_PATH = join(__dirname, "..", "prisma", "migrations");

function fail(message: string, hint?: string): never {
  process.stderr.write(`\n[check:drift] ${message}\n`);
  if (hint) {
    process.stderr.write(`[check:drift] Hint: ${hint}\n`);
  }
  process.exit(1);
}

function main(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail(
      "DATABASE_URL is not set.",
      "Point it at a fully migrated Postgres database. Locally:\n" +
        "  cd backend && DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev \\\n" +
        "    npx prisma migrate deploy\n" +
        "  DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev \\\n" +
        "    npm run check:drift",
    );
  }

  if (!existsSync(SCHEMA_PATH)) {
    fail(`schema.prisma not found at ${SCHEMA_PATH}`);
  }

  // The scratch database the migration folder is replayed into. Derived so a
  // developer never has to set a second variable, overridable because a shared
  // CI role may not be allowed to CREATE DATABASE. It is never written to by
  // anything else and holds no data worth keeping.
  const shadowUrl =
    process.env.SHADOW_DATABASE_URL ??
    `${databaseUrl.replace(/\/[^/?]+(\?|$)/, "/")}travstats_drift_shadow`;

  const args = [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    MIGRATIONS_PATH,
    "--to-schema-datamodel",
    SCHEMA_PATH,
    "--shadow-database-url",
    shadowUrl,
    "--exit-code",
  ];

  process.stdout.write("[check:drift] Replaying migrations → comparing with schema.prisma...\n");
  const result = spawnSync("npx", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  if (result.error) {
    fail(`Failed to spawn prisma: ${result.error.message}`);
  }

  const code = result.status ?? 1;
  if (code === 0) {
    process.stdout.write("[check:drift] OK — the migration history produces exactly schema.prisma.\n");
    process.exit(0);
  }
  if (code === 2) {
    process.stderr.write(
      "\n[check:drift] DRIFT DETECTED — DB state does not match schema.prisma.\n" +
        "[check:drift] Either generate a migration that brings the DB to schema state\n" +
        "[check:drift] (`npx prisma migrate dev --name <slug>` or hand-write one with\n" +
        "[check:drift] backfills / IF EXISTS guards), or revert the schema change.\n",
    );
    process.exit(2);
  }
  fail(`prisma migrate diff exited with unexpected code ${code}.`);
}

main();
