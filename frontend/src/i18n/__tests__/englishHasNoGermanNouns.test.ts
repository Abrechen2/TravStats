import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ferry overview card read "Fähre rides" in English: a German noun had been
 * spliced into the EN bundle by a find-and-replace from the bus copy. Parity
 * checks only compare keys, so a half-translated value passes all of them.
 * These are the domain nouns of this app; none of them is ever English.
 */
const GERMAN_DOMAIN_NOUNS =
  /(?<!\p{L})(Fähre|Fähren|Überfahrt(en)?|Flüge|Unterkunft|Unterkünfte|Kreuzfahrt(en)?|Bahnhof|Abfahrt|Ankunft|Reederei)(?!\p{L})/u;

const EN_DIR = path.resolve(__dirname, "..", "resources", "en");

function strings(node: unknown, prefix: string): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => strings(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

describe("the English bundle carries no German domain noun", () => {
  const files = fs.readdirSync(EN_DIR).filter((f) => f.endsWith(".json"));
  it.each(files)("%s", (file) => {
    const bundle: unknown = JSON.parse(fs.readFileSync(path.join(EN_DIR, file), "utf8"));
    const offenders = strings(bundle, "").filter(([, value]) => GERMAN_DOMAIN_NOUNS.test(value));
    expect(offenders).toEqual([]);
  });
});
