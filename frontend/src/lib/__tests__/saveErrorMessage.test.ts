import { describe, it, expect } from "vitest";
import { isTransientSaveError, saveErrorMessage } from "../saveErrorMessage";
import { TRACK_ERROR_KEYS } from "../trackErrorKeys";

const t = (key: string): string => key;
const refused = (status: number, data: Record<string, unknown>) => ({
  isAxiosError: true,
  response: { status, data },
});

/**
 * A failed save shows the reader a sentence in their language, chosen by the
 * server's code — never the server's `error` text (English prose, or zod's
 * JSON issue dump).
 */
describe("saveErrorMessage", () => {
  it("maps a shared code to its sentence", () => {
    const err = refused(400, { error: '[{"code":"invalid_type"}]', code: "VALIDATION_FAILED" });
    expect(saveErrorMessage(err, t, "form.saveError")).toBe("common:saveErrors.validation");
  });

  // Acceptance 2026-09-26: a broken zone lookup stored a local time as UTC in
  // silence. The server now refuses with a code; the form must say why.
  it("names a broken time zone lookup instead of the generic sentence", () => {
    const err = refused(503, {
      error: "Time zone lookup unavailable: find is not a function",
      code: "TIMEZONE_LOOKUP_UNAVAILABLE",
    });
    expect(saveErrorMessage(err, t, "form.saveError")).toBe(
      "common:saveErrors.timezoneUnavailable"
    );
  });

  // ADR 0002 D2: 422 TZ_UNRESOLVED means the lookup ran and this place has no
  // zone. Telling the user to call the administrator would be wrong — the
  // place is what is missing, so it gets its own sentence.
  it("says the place has no time zone, apart from a broken lookup", () => {
    const err = refused(422, {
      error: "This place has no time zone: no catalogue zone, no coordinates",
      code: "TZ_UNRESOLVED",
    });
    expect(saveErrorMessage(err, t, "form.saveError")).toBe("common:saveErrors.timezoneUnresolved");
  });

  it("lets a caller's own codes win, e.g. a track without timestamps", () => {
    const err = refused(400, {
      error: "This recording has no timestamps, so it cannot be placed in time",
      code: "TRACK_NO_TIMESTAMPS",
    });
    expect(saveErrorMessage(err, t, "upload.error", TRACK_ERROR_KEYS)).toBe(
      "trips:tours.tracks.errors.noTimestamps"
    );
  });

  it("names an empty Dawarich window", () => {
    const err = refused(409, { error: "No location data…", code: "DAWARICH_WINDOW_EMPTY" });
    expect(saveErrorMessage(err, t, "pull.error", TRACK_ERROR_KEYS)).toBe(
      "trips:tours.tracks.errors.windowEmpty"
    );
  });

  it("falls back to the form's key for prose without a code", () => {
    expect(saveErrorMessage(refused(404, { error: "Trip not found" }), t, "form.saveError")).toBe(
      "form.saveError"
    );
  });

  it("says the server is unreachable when there was no answer at all", () => {
    expect(saveErrorMessage({ isAxiosError: true }, t, "form.saveError")).toBe(
      "common:saveErrors.network"
    );
  });

  it("says the demo account cannot save", () => {
    expect(
      saveErrorMessage(refused(403, { error: "DEMO_ACCOUNT_FORBIDDEN" }), t, "form.saveError")
    ).toBe("common:saveErrors.demo");
  });
});

// Review fix round 1: "is trying again likely to help?" has one home, so the
// eight forms offering a retry cannot disagree about it.
describe("isTransientSaveError", () => {
  it("is true for failures a second try can cure", () => {
    expect(isTransientSaveError("common:saveErrors.network")).toBe(true);
    expect(isTransientSaveError("common:saveErrors.dbUnavailable")).toBe(true);
    expect(isTransientSaveError("common:saveErrors.rateLimited")).toBe(true);
  });

  it("is false for a refusal of the input itself", () => {
    expect(isTransientSaveError("common:saveErrors.validation")).toBe(false);
    expect(isTransientSaveError("common:saveErrors.duplicate")).toBe(false);
    expect(isTransientSaveError("lodging:form.saveError")).toBe(false);
  });
});
