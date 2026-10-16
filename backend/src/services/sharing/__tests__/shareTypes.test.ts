import { afterAll, describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { prisma } from "../../../db";
import { DOMAIN_KEYS } from "../../../shared/domains";
import { ADAPTERS } from "../adapters";
import { DOMAIN_SHARING, SHARE_ENTITIES, SHARE_TYPES } from "../shareTypes";

/**
 * The shareable entry types are ONE list (spec 2026-10-16, D1). Bus was missing
 * from ten hand-kept lists until forgejo#288, and ferry carried a `share_key`
 * column nothing read. This suite holds the registry against the database,
 * the domain registry, the adapters and the inbox's own labels.
 */

/** Tables that carry `share_key` but are not shareable YET. Only shrinks. */
const UNWIRED_SHARE_KEY_TABLES: readonly string[] = [];

const sharingJson = (lang: "de" | "en") =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../../frontend/src/i18n/resources/${lang}/sharing.json`),
      "utf8"
    )
  ) as { entityTypes: Record<string, string>; fields: Record<string, unknown> };

afterAll(async () => {
  await prisma.$disconnect();
});

describe("share type registry", () => {
  it("lists exactly the tables that carry a share_key column", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE column_name = 'share_key' AND table_schema = current_schema()`;
    const inDb = rows.map((r) => r.table_name).sort();
    const registered = SHARE_ENTITIES.map((e) => SHARE_TYPES[e].table);
    expect(inDb).toEqual([...registered, ...UNWIRED_SHARE_KEY_TABLES].sort());
  });

  it("has no stale unwired table", () => {
    const registered = new Set(SHARE_ENTITIES.map((e) => SHARE_TYPES[e].table));
    expect(UNWIRED_SHARE_KEY_TABLES.filter((t) => registered.has(t))).toEqual([]);
  });

  it("classifies every domain, and a shared domain names a type of its own", () => {
    for (const domain of DOMAIN_KEYS) {
      const rule = DOMAIN_SHARING[domain];
      if (typeof rule === "string") {
        expect(SHARE_TYPES[rule].domain).toBe(domain);
      } else {
        expect(rule.notShared.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it("has an adapter for every type, under its own name", () => {
    for (const entity of SHARE_ENTITIES) expect(ADAPTERS[entity].entity).toBe(entity);
  });

  it("carries every shareable type in the .travstats file", () => {
    expect(SHARE_ENTITIES.filter((e) => SHARE_TYPES[e].exchangeKind === null)).toEqual([]);
  });

  it("keeps stops last: a stop resolves the entry it wraps by key", () => {
    expect(SHARE_ENTITIES[SHARE_ENTITIES.length - 1]).toBe("stop");
  });

  it.each(["de", "en"] as const)("names every type in the %s inbox", (lang) => {
    expect(Object.keys(sharingJson(lang).entityTypes).sort()).toEqual(
      ["trip", ...SHARE_ENTITIES].sort()
    );
  });

  it.each(["de", "en"] as const)("labels every fact field in %s", (lang) => {
    const labels = new Set(Object.keys(sharingJson(lang).fields));
    const missing = SHARE_ENTITIES.flatMap((e) =>
      ADAPTERS[e].fields.filter((f) => !labels.has(f)).map((f) => `${e}.${f}`)
    );
    expect(missing).toEqual([]);
  });
});
