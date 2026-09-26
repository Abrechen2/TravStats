import { describe, it, expect } from "vitest";
import { saveErrorMessage } from "../saveErrorMessage";
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
