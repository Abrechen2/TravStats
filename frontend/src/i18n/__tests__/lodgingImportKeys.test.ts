import { describe, expect, it } from "vitest";
import deImport from "../resources/de/import.json";
import enImport from "../resources/en/import.json";
import deLodging from "../resources/de/lodging.json";
import enLodging from "../resources/en/lodging.json";
import { LODGING_CSV_FIELDS } from "../../lib/importers/lodgingCsv";
import type {
  LodgingDedupeHint,
  LodgingImportFlag,
  LodgingImportRowFailureCode,
  LodgingImportSource,
} from "../../types/lodgingImport";

// Hardcoded literal unions mirroring the real types (types are erased at
// runtime, same convention as `commonKeys.test.ts`'s `dynamicUnions`). Kept
// in sync manually — if a new flag/dedupeHint/failureCode value is added to
// the type without a matching translation key, this suite won't catch a
// forgotten array entry, but it WILL catch a forgotten translation key for
// every entry that IS listed here.
const FLAGS = [
  "missing_name",
  "unresolvable_lodging_name",
  "ambiguous_lodging_name",
  "malformed_date",
  "invalid_date_range",
  "missing_coordinates",
] as const satisfies readonly LodgingImportFlag[];

// "none" is deliberately excluded — `LodgingImportPreviewModal` only renders
// the dedupe-hint badge when `row.dedupeHint !== "none"`, so "none" is never
// looked up as a translation key.
const DEDUPE_HINTS = [
  "lodging_exact_ref",
  "lodging_name_city",
  "stay_exact_ref",
  "stay_same_dates",
] as const satisfies readonly Exclude<LodgingDedupeHint, "none">[];

const FAILURE_CODES = [
  "ownership_mismatch",
  "missing_lodging_reference",
  "unexpected_error",
] as const satisfies readonly LodgingImportRowFailureCode[];

// Task 18b — the batch-list ("Bisherige Importe") source labels.
const SOURCES = ["csv", "email", "pdf"] as const satisfies readonly LodgingImportSource[];

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe("lodging import i18n", () => {
  it("has the panel strings in both locales", () => {
    expect(deImport.lodging.panelTitle).toBeTruthy();
    expect(deImport.lodging.panelHint).toBeTruthy();
    expect(enImport.lodging.panelTitle).toBeTruthy();
    expect(enImport.lodging.panelHint).toBeTruthy();
  });

  it("has a label for every CSV field in both locales", () => {
    for (const field of LODGING_CSV_FIELDS) {
      expect(deLodging.import.fields[field], `de fields.${field}`).toBeTruthy();
      expect(enLodging.import.fields[field], `en fields.${field}`).toBeTruthy();
    }
  });

  it("has a label for every preview flag in both locales", () => {
    for (const flag of FLAGS) {
      expect(deLodging.import.flags[flag], `de flags.${flag}`).toBeTruthy();
      expect(enLodging.import.flags[flag], `en flags.${flag}`).toBeTruthy();
    }
  });

  it("has a label for every non-none dedupe hint in both locales", () => {
    for (const hint of DEDUPE_HINTS) {
      expect(deLodging.import.dedupeHints[hint], `de dedupeHints.${hint}`).toBeTruthy();
      expect(enLodging.import.dedupeHints[hint], `en dedupeHints.${hint}`).toBeTruthy();
    }
  });

  it("has a label for every commit-result failure code in both locales", () => {
    for (const code of FAILURE_CODES) {
      expect(
        deLodging.import.commitResult.failureCodes[code],
        `de commitResult.failureCodes.${code}`
      ).toBeTruthy();
      expect(
        enLodging.import.commitResult.failureCodes[code],
        `en commitResult.failureCodes.${code}`
      ).toBeTruthy();
    }
  });

  it("carries {{count}} inside the pluralised skipped-rows string", () => {
    expect(deLodging.import.errors.skippedRows).toContain("{{count}}");
    expect(enLodging.import.errors.skippedRows).toContain("{{count}}");
  });

  it("carries the preview count labels (new / already present / needs input) in both locales", () => {
    // The real preview header does NOT use a single interpolated
    // "{{newRows}} ... {{alreadyPresent}} ... {{needsInput}}" string (that
    // was the brief's assumption) — `LodgingImportPreviewModal` renders the
    // three counters as raw numbers interpolated inline in JSX, each
    // followed by its own translated label (`newLabel` / `presentLabel` /
    // `needsInputLabel`). Verify those three labels directly instead.
    for (const locale of [deLodging, enLodging]) {
      expect(locale.import.preview.newLabel).toBeTruthy();
      expect(locale.import.preview.presentLabel).toBeTruthy();
      expect(locale.import.preview.needsInputLabel).toBeTruthy();
      expect(locale.import.preview.needsInputHint).toBeTruthy();
    }
  });

  it("interpolates the commit-result counters", () => {
    // #261: the counts arrive as pre-pluralized unit phrases ({{hotels}} =
    // t("lodging:units.hotels", {count}) etc.), never as "Hotel(s)".
    for (const locale of [deLodging, enLodging]) {
      expect(locale.import.commitResult.success).toContain("{{hotels}}");
      expect(locale.import.commitResult.success).toContain("{{stays}}");
      // Finding 3: `skipped` must be shown, not just created/failed — a
      // same-file re-import (everything skipped, nothing failed) otherwise
      // reads as a silent "0 hotels, 0 stays imported".
      expect(locale.import.commitResult.success).toContain("{{skipped}}");
      expect(locale.import.commitResult.partial).toContain("{{hotels}}");
      expect(locale.import.commitResult.partial).toContain("{{stays}}");
      expect(locale.import.commitResult.partial).toContain("{{skipped}}");
      expect(locale.import.commitResult.partial).toContain("{{rows}}");
      expect(locale.import.commitResult.partial).toContain("{{reasons}}");
      // The unit phrases themselves must exist with proper plural forms.
      expect(locale.units.hotels_one).toContain("{{count}}");
      expect(locale.units.hotels_other).toContain("{{count}}");
      expect(locale.units.stays_one).toContain("{{count}}");
      expect(locale.units.stays_other).toContain("{{count}}");
      expect(locale.units.rows_one).toContain("{{count}}");
      expect(locale.units.rows_other).toContain("{{count}}");
    }
  });

  // Task 18b — the batch-list ("Bisherige Importe") + revert UI.
  it("has the batch-list section strings in both locales", () => {
    for (const locale of [deLodging, enLodging]) {
      expect(locale.import.batches.title).toBeTruthy();
      expect(locale.import.batches.loading).toBeTruthy();
      expect(locale.import.batches.empty).toBeTruthy();
      expect(locale.import.batches.loadError).toBeTruthy();
      expect(locale.import.batches.revert).toBeTruthy();
      expect(locale.import.batches.revertError).toBeTruthy();
      expect(locale.import.batches.confirmTitle).toBeTruthy();
      expect(locale.import.batches.confirmMessage).toBeTruthy();
    }
  });

  it("has a source label for every lodging import source in both locales", () => {
    for (const source of SOURCES) {
      expect(deLodging.import.batches.source[source], `de batches.source.${source}`).toBeTruthy();
      expect(enLodging.import.batches.source[source], `en batches.source.${source}`).toBeTruthy();
    }
  });

  it("interpolates the batch created-counts label", () => {
    for (const locale of [deLodging, enLodging]) {
      expect(locale.import.batches.created).toContain("{{hotels}}");
      expect(locale.import.batches.created).toContain("{{stays}}");
    }
  });

  // Owner-decided revert semantics: a batch-created lodging with foreign
  // stays survives, detached — `detachedLodgings` must be renderable
  // wherever the result carries a non-zero count, so `withDetached` must
  // interpolate all three counters while the clean `success` string only
  // needs the two delete counters (no hidden zero to fake).
  it("interpolates the revert-result counters", () => {
    for (const locale of [deLodging, enLodging]) {
      expect(locale.import.batches.revertResult.success).toContain("{{hotels}}");
      expect(locale.import.batches.revertResult.success).toContain("{{stays}}");
      expect(locale.import.batches.revertResult.withDetached).toContain("{{hotels}}");
      expect(locale.import.batches.revertResult.withDetached).toContain("{{stays}}");
      expect(locale.import.batches.revertResult.withDetached).toContain("{{kept}}");
    }
  });

  it("keeps the DE and EN lodging trees structurally identical", () => {
    expect(flatten(deLodging).sort()).toEqual(flatten(enLodging).sort());
  });

  it("keeps the DE and EN import trees structurally identical", () => {
    expect(flatten(deImport).sort()).toEqual(flatten(enImport).sort());
  });
});
