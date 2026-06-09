/**
 * Schema-drift regression check.
 *
 * Runs `prisma migrate diff --from-schema-datasource --to-schema-datamodel --exit-code`
 * against a fully migrated database. If the live DB state (after `prisma
 * migrate deploy`) and `schema.prisma` disagree, exits with code 2 — the
 * same convention used by `--exit-code`.
 *
 * Why this exists: in 2026-04 the prod DB was found to have drifted from
 * `schema.prisma` (NOT NULL flips on `flights.has_live_tracking`,
 * `user_settings.historical_enrichment_*` etc.). Migration `20260419140000_schema_drift_fix`
 * resolved it. This script runs in CI so the same gap can never reopen
 * silently — the next person editing `schema.prisma` without a matching
 * migration will get a red CI build instead of a hand-written hotfix
 * after a prod incident.
 *
 * Why `--from-schema-datasource` and not `--from-migrations`: with the
 * `postgresqlExtensions` preview feature enabled, `--from-migrations`
 * does not register raw `CREATE EXTENSION` statements applied to the
 * shadow DB and reports postgis as drift on every run. Comparing the
 * live post-migration DB state directly is both more correct (it
 * matches what would actually go to prod) and avoids that quirk.
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
import { resolve } from "node:path";

const SCHEMA_PATH = resolve(__dirname, "..", "prisma", "schema.prisma");

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

  const args = [
    "prisma",
    "migrate",
    "diff",
    "--from-schema-datasource",
    SCHEMA_PATH,
    "--to-schema-datamodel",
    SCHEMA_PATH,
    "--exit-code",
  ];

  process.stdout.write("[check:drift] Comparing live DB state → schema.prisma...\n");
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
    process.stdout.write("[check:drift] OK — DB state and schema.prisma agree.\n");
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
