import { describe, it, expect } from "vitest";
import { stayDraftFields } from "../stayEditorDraft";
import type { LodgingStay } from "../../../types/lodging";

describe("stayDraftFields - the days", () => {
  it("reads the hotel's own days from `times`, like the overlap rule and the lists", () => {
    // The legacy anchor is an hour off the calendar day; `times` says 12 July.
    const stay = {
      checkIn: "2026-07-11T23:00:00.000Z",
      checkOut: "2026-07-13T23:00:00.000Z",
      times: {
        checkIn: { date: "2026-07-12", zone: null, precision: "day" },
        checkOut: { date: "2026-07-14", zone: null, precision: "day" },
      },
    } as unknown as LodgingStay;
    const fields = stayDraftFields(stay, "EUR");
    expect(fields.checkIn).toBe("2026-07-12");
    expect(fields.checkOut).toBe("2026-07-14");
  });

  it("falls back to the stored day where `times` is absent, and is empty for a new stay", () => {
    const legacy = {
      checkIn: "2026-07-11T00:00:00.000Z",
      checkOut: null,
    } as unknown as LodgingStay;
    expect(stayDraftFields(legacy, "EUR")).toMatchObject({ checkIn: "2026-07-11", checkOut: "" });
    expect(stayDraftFields(null, "EUR")).toMatchObject({ checkIn: "", checkOut: "" });
  });
});
