import { describe, expect, it } from "vitest";
import deCruise from "../resources/de/cruise.json";
import enCruise from "../resources/en/cruise.json";

/**
 * The cruise edit dialog's trip picker (#general, 2026-08-26). Every other
 * domain could already be linked to a trip; the cruise form was the only one
 * without the control, so these two keys are new and exist in no locale yet.
 *
 * Asserting presence per locale rather than a literal wording on purpose: a
 * test that repeats the German copy would only prove the copy equals itself.
 * What can actually break here is a key added to one language and forgotten in
 * the other — which is exactly what ships an untranslated raw key into the UI.
 */
const REQUIRED_KEYS = ["trip", "noTrip"] as const;

const LOCALES = {
  de: deCruise,
  en: enCruise,
} as const;

describe("cruise trip-assignment copy", () => {
  for (const [locale, resource] of Object.entries(LOCALES)) {
    for (const key of REQUIRED_KEYS) {
      it(`${locale}: field.${key} is present and non-empty`, () => {
        const field = (resource as { field?: Record<string, unknown> }).field;
        expect(field, `${locale}/cruise.json has no "field" section`).toBeDefined();
        const value = field?.[key];
        expect(typeof value, `${locale}/cruise.json is missing field.${key}`).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
      });
    }
  }

  // The list header reads its label from `list.columns.<id>`, so the new
  // column needs its own entry — without it the header prints the raw key.
  it.each(["de", "en"] as const)("%s: list.columns.trip is present and non-empty", (locale) => {
    const columns = (LOCALES[locale] as { list?: { columns?: Record<string, unknown> } }).list
      ?.columns;
    expect(columns, `${locale}/cruise.json has no list.columns section`).toBeDefined();
    const value = columns?.trip;
    expect(typeof value, `${locale}/cruise.json is missing list.columns.trip`).toBe("string");
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it("does not leave one language behind the other", () => {
    const deField = Object.keys((deCruise as { field: Record<string, unknown> }).field);
    const enField = Object.keys((enCruise as { field: Record<string, unknown> }).field);
    for (const key of REQUIRED_KEYS) {
      expect(deField).toContain(key);
      expect(enField).toContain(key);
    }
  });
});
