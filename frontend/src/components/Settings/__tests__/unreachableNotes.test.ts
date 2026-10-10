import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * forgejo#88 (acceptance criterion of 2026-09-18): every settings card that
 * names a service outside this server says what happens when it does not
 * answer. Each card's sentence was written from its code path, so this pins
 * that the sentence is WIRED — a new card, or a new provider row, without one
 * fails here instead of shipping silent.
 */
const dir = resolve(__dirname, "..");
const read = (name: string): string => readFileSync(resolve(dir, `${name}.tsx`), "utf8");

const CARDS = [
  "ImmichConnectionCard",
  "PhotoJourneyNightlyScanCard",
  "DawarichConnectionCard",
  "StravaConnectionCard",
  "RailProvidersCard",
  "OpenDataCard",
];

describe("external-service cards say what happens when the service is unreachable", () => {
  it.each(CARDS)("%s", (name) => {
    expect(read(name)).toMatch(/whenUnreachable=\{t\("settings:unreachable\.\w+"/);
  });

  it("every provider row in the user's external services carries one", () => {
    for (const name of ["ApiKeysSection", "PersonalRoutingKeysSection"]) {
      const source = read(name);
      const cards = source.split("<ApiKeyCard").slice(1);
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.slice(0, card.indexOf("/>"))).toContain("whenUnreachable=");
      }
    }
  });
});
