/**
 * Prisma CLI configuration (Prisma 7).
 *
 * Prisma 7 dropped the `--schema` and `--url` flags and stopped reading
 * `.env` by itself, and `migrate diff` lost `--shadow-database-url`. Every
 * one of those now comes from this file, so it is not optional decoration:
 * without it `prisma migrate deploy` in the Docker entrypoint and
 * `prisma migrate diff --from-migrations` in `scripts/check-schema-drift.ts`
 * have no datasource at all.
 *
 * `dotenv/config` restores the one convenience Prisma 7 removed — loading
 * `backend/.env` for local CLI runs. It is a no-op where no `.env` exists,
 * which is every deployed instance: there DATABASE_URL arrives as a real
 * environment variable from docker-compose. `dotenv` never overwrites a
 * variable that is already set, so an explicit `DATABASE_URL=... npx prisma
 * …` still wins over the file — which is how every command in CLAUDE.md is
 * written and how the drift check hands down its shadow URL.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Read once, and only pass on what is actually set. The `env()` helper is not
// used here because it THROWS on a missing variable while the config module is
// being loaded — which would break `prisma generate`, the one command that
// needs no database at all and is run during the Docker build where no
// DATABASE_URL exists. Omitting the field instead lets the commands that DO
// need a connection fail with Prisma's own message about the datasource.
const url = process.env.DATABASE_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(url ? { datasource: { url, ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}) } } : {}),
});
