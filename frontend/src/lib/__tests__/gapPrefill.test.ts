import { describe, it, expect } from "vitest";
import { busGapDraft } from "../../components/bus/busGapDraft";
import { initial as ferryInitial } from "../../components/ferry/FerryFormModal";
import { stayDraftFields } from "../../components/lodging/stayEditorDraft";
import { visitDraft } from "../../components/places/visitDialogModel";
import { railGapDraft } from "../../components/rail/railGapDraft";
import { emptyRentalDraft } from "../../components/rental/rentalFormModel";
import { gapCreateUrl, gapDatesFromParams, GAP_CREATE_TARGETS } from "../gapCalendar";

/**
 * What each create form opens with when the gap calendar names days. Every one
 * used to start on today / empty: the dates the link carried were thrown away.
 */

const GAP = { from: "2024-03-04", to: "2024-03-07" };

describe("gap prefill — dates from the URL", () => {
  it("takes a real first day, and the last day only when it is real and not earlier", () => {
    expect(gapDatesFromParams("2024-03-04", "2024-03-07")).toEqual(GAP);
    expect(gapDatesFromParams("2024-03-04", null)).toEqual({
      from: "2024-03-04",
      to: "2024-03-04",
    });
    expect(gapDatesFromParams("2024-03-04", "2024-03-01")).toEqual({
      from: "2024-03-04",
      to: "2024-03-04",
    });
    expect(gapDatesFromParams("2023-02-29", "2024-03-07")).toBeNull();
    expect(gapDatesFromParams(null, "2024-03-07")).toBeNull();
  });

  it("every create target has a link carrying both days", () => {
    for (const target of GAP_CREATE_TARGETS) {
      expect(gapCreateUrl(target.path, GAP)).toBe(
        `${target.path}?addFrom=2024-03-04&addTo=2024-03-07`
      );
    }
    expect(GAP_CREATE_TARGETS.map((t) => t.id)).toEqual([
      "trip",
      "flight",
      "lodging",
      "rail",
      "bus",
      "ferry",
      "rental",
      "place",
    ]);
  });
});

describe("gap prefill — each form's starting values", () => {
  it("rail: a new ride whose two ends are the gap's days, day only", () => {
    const d = railGapDraft(GAP);
    expect([d.departureLocal, d.arrivalLocal]).toEqual(["2024-03-04", "2024-03-07"]);
    expect([d.departureDayOnly, d.arrivalDayOnly]).toEqual([true, true]);
  });

  it("bus: the same", () => {
    const d = busGapDraft(GAP);
    expect([d.departureLocal, d.arrivalLocal]).toEqual(["2024-03-04", "2024-03-07"]);
    expect([d.departureDayOnly, d.arrivalDayOnly]).toEqual([true, true]);
  });

  it("ferry: a new crossing departs and arrives on the gap's days; an edit ignores the gap", () => {
    const f = ferryInitial(null, GAP);
    expect([f.departureLocal, f.arrivalLocal]).toEqual(["2024-03-04T00:00", "2024-03-07T00:00"]);
    expect(ferryInitial(null).departureLocal).toBe("");
  });

  it("rental: pickup and return on the gap's days, day only; without a gap, empty", () => {
    const d = emptyRentalDraft(GAP);
    expect([d.pickupLocal, d.returnLocal]).toEqual(["2024-03-04", "2024-03-07"]);
    expect([d.dayOnly.pickup, d.dayOnly.return]).toEqual([true, true]);
    expect(emptyRentalDraft().pickupLocal).toBe("");
  });

  it("stay: a new stay checks in and out on the gap's days", () => {
    const d = stayDraftFields(null, "EUR", GAP);
    expect([d.checkIn, d.checkOut]).toEqual(["2024-03-04", "2024-03-07"]);
    expect(stayDraftFields(null, "EUR").checkIn).toBe("");
  });

  it("place visit: a new visit opens on the gap's first day, not today", () => {
    const d = visitDraft(null, "2024-03-04");
    expect([d.mode, d.date]).toEqual(["other", "2024-03-04"]);
    expect(visitDraft(null).mode).toBe("today");
  });
});
