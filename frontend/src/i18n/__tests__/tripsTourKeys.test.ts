import { describe, expect, it } from "vitest";
import deTrips from "../resources/de/trips.json";
import enTrips from "../resources/en/trips.json";
import deSettings from "../resources/de/settings.json";
import enSettings from "../resources/en/settings.json";
import { LEG_MODES, LEG_SOURCES, ROUTING_PROVIDER_IDS } from "../../types/tour";

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
 *
 * Task 8 (phase 3) extends this same guard to `settings:routing.*` — the
 * admin-only routing-provider card lives in a different namespace file
 * (settings.json, not trips.json) but is part of the same tour-routing
 * feature and was written in the same task, so it gets the same coverage
 * here instead of a second near-duplicate test file.
 *
 * Fix round 1 of Task 8: the "every leaf that exists is non-empty" and
 * "the two locales' key sets match" checks above both pass trivially when a
 * key is missing from BOTH locales — and the keys most likely to go missing
 * that way are exactly the ones no static grep can see, because the code
 * builds them from a template literal (`` t(`trips:tours.mode.${mode}`) ``,
 * `` t(`trips:tours.source.${source}`) ``,
 * `` t(`settings:routing.provider.${id}`) ``). Add a `LegMode`, a
 * `LegSource`, or a `RoutingProviderId` later and nothing above
 * fails — the UI just renders the raw key at the user. The blocks below fix
 * that by binding to the TypeScript unions the frontend already keeps these
 * three vocabularies in (`types/tour.ts`), the same way Task 1's invariant
 * test binds `PROFILE_BY_MODE` to `isRoutableMode`: iterating what exists in
 * the JSON only proves that what someone remembered to add is non-empty;
 * iterating the union proves that everything the code can ask for has an
 * answer, whether or not anyone remembered to add it.
 */

const LOCALES = {
  de: deTrips,
  en: enTrips,
} as const;

const SETTINGS_LOCALES = {
  de: deSettings,
  en: enSettings,
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

describe("settings routing-provider copy", () => {
  it.each(["de", "en"] as const)(
    "%s: routing.* section exists and every leaf is a non-empty string",
    (locale) => {
      const routing = (SETTINGS_LOCALES[locale] as { routing?: Record<string, unknown> }).routing;
      expect(routing, `${locale}/settings.json has no routing section`).toBeDefined();
      const leafKeys = flatten(routing, "routing");
      expect(leafKeys.length).toBeGreaterThan(0);
      for (const key of leafKeys) {
        const parts = key.split(".").slice(1); // drop the leading "routing"
        let value: unknown = routing;
        for (const part of parts) {
          value = (value as Record<string, unknown> | undefined)?.[part];
        }
        expect(typeof value, `${locale}/settings.json is missing routing.${parts.join(".")}`).toBe(
          "string"
        );
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    }
  );

  it("does not leave one language behind the other", () => {
    const deRoutingKeys = flatten(
      (deSettings as { routing: Record<string, unknown> }).routing
    ).sort();
    const enRoutingKeys = flatten(
      (enSettings as { routing: Record<string, unknown> }).routing
    ).sort();
    expect(deRoutingKeys).toEqual(enRoutingKeys);
  });
});

describe("tour vocabulary bound to its TypeScript union (fix round 1)", () => {
  it.each(["de", "en"] as const)("%s: every LegMode has a tours.mode label", (locale) => {
    const modes = (LOCALES[locale] as { tours: { mode: Record<string, unknown> } }).tours.mode;
    for (const mode of LEG_MODES) {
      expect(typeof modes[mode], `${locale}/trips.json is missing tours.mode.${mode}`).toBe(
        "string"
      );
      expect((modes[mode] as string).trim().length).toBeGreaterThan(0);
    }
  });

  it.each(["de", "en"] as const)(
    "%s: every LegSource has a tours.source label",
    (locale) => {
      const sources = (LOCALES[locale] as { tours: { source: Record<string, unknown> } }).tours
        .source;
      for (const source of LEG_SOURCES) {
        expect(
          typeof sources[source],
          `${locale}/trips.json is missing tours.source.${source}`
        ).toBe("string");
        expect((sources[source] as string).trim().length).toBeGreaterThan(0);
      }
    }
  );

  it.each(["de", "en"] as const)(
    "%s: every RoutingProviderId has a settings routing.provider label",
    (locale) => {
      const providers = (
        SETTINGS_LOCALES[locale] as { routing: { provider: Record<string, unknown> } }
      ).routing.provider;
      for (const id of ROUTING_PROVIDER_IDS) {
        expect(
          typeof providers[id],
          `${locale}/settings.json is missing routing.provider.${id}`
        ).toBe("string");
        expect((providers[id] as string).trim().length).toBeGreaterThan(0);
      }
    }
  );
});
