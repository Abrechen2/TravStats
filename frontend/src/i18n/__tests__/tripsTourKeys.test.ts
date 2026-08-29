import { describe, expect, it } from "vitest";
import deTrips from "../resources/de/trips.json";
import enTrips from "../resources/en/trips.json";

/**
 * Tour route sections (dev/tour-routes). The Touren tab rendered the raw
 * i18n key `detail.tabs.tours` because `detail.tabs` in trips.json only ever
 * held overview/timeline/map/gallery/logistics — the new tab's key was never
 * added to either locale. That regression is exactly the shape the sibling
 * `cruiseTripKeys.test.ts` guards against for the cruise trip picker, so this
 * test follows the same shape for the trips namespace.
 *
 * Asserting presence per locale rather than a literal wording on purpose: a
 * test that repeats the German copy would only prove the copy equals itself.
 * What can actually break here is a key added to one language and forgotten
 * in the other — which is exactly what ships an untranslated raw key into
 * the UI.
 */

const LOCALES = {
  de: deTrips,
  en: enTrips,
} as const;

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe("trips tour-section copy", () => {
  it.each(["de", "en"] as const)("%s: detail.tabs.tours is present and non-empty", (locale) => {
    const tabs = (LOCALES[locale] as { detail?: { tabs?: Record<string, unknown> } }).detail
      ?.tabs;
    expect(tabs, `${locale}/trips.json has no detail.tabs section`).toBeDefined();
    const value = tabs?.tours;
    expect(typeof value, `${locale}/trips.json is missing detail.tabs.tours`).toBe("string");
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it.each(["de", "en"] as const)("%s: tours.* section exists and every leaf is a non-empty string", (locale) => {
    const tours = (LOCALES[locale] as { tours?: Record<string, unknown> }).tours;
    expect(tours, `${locale}/trips.json has no tours section`).toBeDefined();
    const leafKeys = flatten(tours, "tours");
    expect(leafKeys.length).toBeGreaterThan(0);
    for (const key of leafKeys) {
      const parts = key.split(".").slice(1); // drop the leading "tours"
      let value: unknown = tours;
      for (const part of parts) {
        value = (value as Record<string, unknown> | undefined)?.[part];
      }
      expect(typeof value, `${locale}/trips.json is missing tours.${parts.join(".")}`).toBe(
        "string"
      );
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  it("does not leave one language behind the other", () => {
    const deTabKeys = Object.keys(
      (deTrips as { detail: { tabs: Record<string, unknown> } }).detail.tabs
    );
    const enTabKeys = Object.keys(
      (enTrips as { detail: { tabs: Record<string, unknown> } }).detail.tabs
    );
    expect(deTabKeys).toContain("tours");
    expect(enTabKeys).toContain("tours");
    expect([...deTabKeys].sort()).toEqual([...enTabKeys].sort());

    const deTourKeys = flatten((deTrips as { tours: Record<string, unknown> }).tours).sort();
    const enTourKeys = flatten((enTrips as { tours: Record<string, unknown> }).tours).sort();
    expect(deTourKeys).toEqual(enTourKeys);
  });
});
