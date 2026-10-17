import { describe, it, expect } from "vitest";
import { WHATS_NEW_ENTRIES, compareVersions, type WhatsNewItem } from "../whatsNew";
import { BETA_FEATURES } from "../../config/betaFeatures";
import de from "../../i18n/resources/de/whatsNew.json";
import en from "../../i18n/resources/en/whatsNew.json";

/**
 * The 2.7.0 announcement was written at rc.1 and grew to eight items of up to
 * 2,000 characters each (8,369 in all) under a subtitle promising "a short
 * overview" (owner, 2026-10-11). This guard keeps it from growing back, and
 * keeps the announcement truthful about what sits behind the beta switch.
 * Entries before 2.7.0 are history and are not held to the length limit.
 */
const MAX_ITEMS = 8;
const MAX_BODY_CHARS = 380;
const GUARDED_FROM = "2.7.0";

const bundles = { de, en } as const;

function resolve(bundle: unknown, dottedKey: string): string | undefined {
  const value = dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
  return typeof value === "string" ? value : undefined;
}

const guarded = WHATS_NEW_ENTRIES.filter((e) => compareVersions(e.version, GUARDED_FROM) >= 0);

/** What a reader would look for on the page, per registry key: [de, en]. */
const KEYWORDS: Record<keyof typeof BETA_FEATURES, [RegExp, RegExp]> = {
  comparison: [/Freundesvergleich|Serververgleich/i, /friend comparison|federation/i],
  encryptedShare: [/verschlüsseltes Teilen/i, /encrypted sharing/i],
  devicePairing: [/koppel/i, /\bpair/i],
  roadtrips: [/Roadtrip|Touren/, /Roadtrip|\btours\b/i],
  lodgingEnrichment: [/Anreicherung/, /enrichment/i],
  railDomain: [/Bahn\b/, /\brail\b/i],
  rentalDomain: [/Mietwagen/, /rental car/i],
  ferryDomain: [/fähre/i, /ferry/i],
  busDomain: [/Fernbus/, /coach/i],
  cruiseTracks: [/Kreuzfahrt-Spuren/, /cruise tracks/i],
  flightTrackUpload: [/Flugspuren/, /flight tracks/i],
  travPlan: [/TravPlan/, /TravPlan/],
};
const keys = Object.keys(KEYWORDS) as (keyof typeof BETA_FEATURES)[];

function text(item: WhatsNewItem, locale: "de" | "en"): string {
  return [item.titleKey, item.bodyKey].map((k) => resolve(bundles[locale], k) ?? "").join(" ");
}

describe("the release announcement stays short and truthful", () => {
  it("guards at least the 2.7.0 entry", () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(guarded.map((e) => [e.version, e] as const))(
    "%s has at most eight items, each with a short body in both languages",
    (_v, entry) => {
      expect(entry.highlights.length).toBeLessThanOrEqual(MAX_ITEMS);
      for (const item of entry.highlights) {
        for (const locale of ["de", "en"] as const) {
          for (const key of [item.titleKey, item.bodyKey]) {
            expect(resolve(bundles[locale], key), `missing ${locale} key ${key}`).toBeTypeOf(
              "string"
            );
          }
          const body = resolve(bundles[locale], item.bodyKey) ?? "";
          expect(
            body.length,
            `${locale} ${item.bodyKey} is ${body.length} characters; the limit is ${MAX_BODY_CHARS}`
          ).toBeLessThanOrEqual(MAX_BODY_CHARS);
        }
      }
    }
  );

  it.each(keys)(
    "names the registered beta feature %s only in items marked beta, and does name it there",
    (key) => {
      const [deRe, enRe] = KEYWORDS[key];
      for (const entry of guarded) {
        for (const item of entry.highlights.filter((h) => !h.beta)) {
          expect(
            text(item, "de"),
            `${item.bodyKey} names "${key}", which is still behind the beta switch — mark the item beta, or un-gate the feature first`
          ).not.toMatch(deRe);
          expect(text(item, "en"), `${item.bodyKey} names "${key}" (en)`).not.toMatch(enRe);
        }
        const betaItems = entry.highlights.filter((h) => h.beta);
        expect(
          betaItems.some((h) => deRe.test(text(h, "de")) && enRe.test(text(h, "en"))),
          `no beta item of ${entry.version} names the gated feature "${key}" in both languages`
        ).toBe(true);
      }
    }
  );
});
