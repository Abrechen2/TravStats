import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20260927130000_llm_named_providers (beta.18) replaces the single
 * admin-picked "active provider" (`llm_provider`) and its one blanket
 * `llm_cloud_opt_in` with four NAMED cloud slots, each carrying its own
 * consent. The promise this test holds: an instance that already configured
 * and consented to the beta.17 `openai_compatible` provider keeps that
 * consent on the renamed `custom` slot — untouched, unmoved — and NOT ONE OF
 * THE THREE NEWLY NAMED SLOTS (openai/anthropic/google) inherits it. Granting
 * OpenAI is a different decision than granting a self-hosted OpenRouter
 * proxy, and the migration must not make that decision FOR the admin.
 *
 * Replayed against a SCRATCH schema holding only the columns the migration
 * touches, in the shape the beta.17 migration
 * (20260927120000_llm_providers) left them.
 */

const DIR = path.join(__dirname, "../../prisma/migrations/20260927130000_llm_named_providers");
const SCHEMA = "migtest_llm_named_providers";

function statements(file: string): string[] {
  return fs
    .readFileSync(path.join(DIR, file), "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const PRE_MIGRATION = [
  `CREATE TABLE admin_settings (
     id SERIAL PRIMARY KEY,
     llm_provider TEXT NOT NULL DEFAULT 'ollama',
     openai_compat_base_url TEXT,
     openai_compat_model TEXT,
     openai_compat_api_key TEXT,
     llm_cloud_opt_in BOOLEAN NOT NULL DEFAULT false
   )`,
  // Row 1: an instance that configured AND consented to the beta.17 cloud
  // slot — the case the migration must carry forward untouched.
  `INSERT INTO admin_settings
     (id, llm_provider, openai_compat_base_url, openai_compat_model, openai_compat_api_key, llm_cloud_opt_in)
     VALUES (1, 'openai_compatible', 'https://openrouter.ai/api/v1', 'meta-llama/llama-3.1-70b',
             'enc:sk-or-abc123', true)`,
  // Row 2: an instance that never touched any of this — Ollama only, no
  // consent ever granted. Must come out exactly as unconfigured as it went in.
  `INSERT INTO admin_settings (id) VALUES (2)`,
];

type Row = Record<string, unknown>;

async function columnsOf(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  table: string
): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = '${table}' ORDER BY column_name`
  );
  return rows.map((r) => r.column_name);
}

describe("migration 20260927130000 — four named cloud slots, each with its own consent", () => {
  let rows: Row[];
  let columns: string[];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements("migration.sql")) await tx.$executeRawUnsafe(sql);

      rows = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM admin_settings ORDER BY id`);
      columns = await columnsOf(tx, "admin_settings");
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  it("drops the old single-selection columns — there is no 'active provider' any more", () => {
    expect(columns).not.toContain("llm_provider");
    expect(columns).not.toContain("llm_cloud_opt_in");
  });

  it("adds every new slot column, plus the chain's own priority order", () => {
    expect(columns).toEqual(
      expect.arrayContaining([
        "llm_ollama_opt_in",
        "llm_provider_order",
        "llm_custom_opt_in",
        "llm_openai_api_key",
        "llm_openai_model",
        "llm_openai_opt_in",
        "llm_anthropic_api_key",
        "llm_anthropic_model",
        "llm_anthropic_opt_in",
        "llm_google_api_key",
        "llm_google_model",
        "llm_google_opt_in",
      ])
    );
  });

  it("carries the beta.17 cloud config onto the custom slot verbatim — base URL, model, key untouched", () => {
    const row = rows.find((r) => r.id === 1);
    expect(row?.openai_compat_base_url).toBe("https://openrouter.ai/api/v1");
    expect(row?.openai_compat_model).toBe("meta-llama/llama-3.1-70b");
    expect(row?.openai_compat_api_key).toBe("enc:sk-or-abc123");
  });

  it("maps the ONE old consent flag onto the custom slot's own — nothing lost", () => {
    const row = rows.find((r) => r.id === 1);
    expect(row?.llm_custom_opt_in).toBe(true);
  });

  it("never re-consents a DIFFERENT company — openai/anthropic/google start unconsented even though custom was allowed", () => {
    const row = rows.find((r) => r.id === 1);
    expect(row?.llm_openai_opt_in).toBe(false);
    expect(row?.llm_anthropic_opt_in).toBe(false);
    expect(row?.llm_google_opt_in).toBe(false);
    expect(row?.llm_openai_api_key).toBeNull();
    expect(row?.llm_anthropic_api_key).toBeNull();
    expect(row?.llm_google_api_key).toBeNull();
  });

  it("an instance that consented to nothing keeps consenting to nothing", () => {
    const row = rows.find((r) => r.id === 2);
    expect(row?.llm_custom_opt_in).toBe(false);
    expect(row?.llm_openai_opt_in).toBe(false);
    expect(row?.llm_anthropic_opt_in).toBe(false);
    expect(row?.llm_google_opt_in).toBe(false);
    expect(row?.llm_ollama_opt_in).toBe(false);
  });

  it("defaults the chain's priority to the registration order", () => {
    for (const row of rows) {
      expect(row.llm_provider_order).toBe("openai,anthropic,google,custom");
    }
  });
});
