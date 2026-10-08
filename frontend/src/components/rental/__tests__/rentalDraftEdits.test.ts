import { describe, expect, it } from "vitest";
import { EMPTY_RENTAL_DRAFT, type RentalDraft } from "../rentalFormModel";
import {
  withDayOnly,
  withSameStation,
  withStation,
  withTime,
  zoneOfEnd,
} from "../rentalDraftEdits";

const FRA = {
  name: "Frankfurt",
  airportId: 1,
  iata: "FRA",
  address: null,
  lat: 50.03,
  lon: 8.57,
  country: "DE",
  timezone: "Europe/Berlin",
};
const LHR = {
  ...FRA,
  name: "London",
  airportId: 2,
  iata: "LHR",
  lat: 51.47,
  lon: -0.45,
  country: "GB",
  timezone: "Europe/London",
};

/** A stored rental whose actual return was the LATER 02:30 of the autumn night. */
const opened: RentalDraft = {
  ...EMPTY_RENTAL_DRAFT,
  pickup: FRA,
  ret: FRA,
  actualReturnLocal: "2026-10-25T02:30",
  folds: { ...EMPTY_RENTAL_DRAFT.folds, actualReturn: "later" },
};

describe("rental draft edits — the occurrence of a repeated hour, per end", () => {
  it("forgets the occurrence when another clock is typed, and gives it back for the opened one", () => {
    const moved = withTime(opened, opened, "actualReturn", "2026-10-25T03:30");
    expect(moved.folds.actualReturn).toBeNull();
    const back = withTime(moved, opened, "actualReturn", "2026-10-25T02:30");
    expect(back.folds.actualReturn).toBe("later");
  });

  it("forgets it on 'date only', and when the return station moves to another place", () => {
    expect(withDayOnly(opened, "actualReturn", true, "2026-10-25").folds.actualReturn).toBeNull();
    // Same station: the pickup station carries the return ends.
    expect(withStation(opened, "pickup", LHR).folds.actualReturn).toBeNull();
    const separate = { ...opened, sameStation: false };
    expect(withStation(separate, "pickup", LHR).folds.actualReturn).toBe("later");
    expect(withStation(separate, "ret", LHR).folds.actualReturn).toBeNull();
  });

  it("keeps it for a rename of the same place", () => {
    expect(withStation(opened, "pickup", { ...FRA, name: "FRA T1" }).folds.actualReturn).toBe(
      "later"
    );
  });

  it("reads each end in its own station's zone", () => {
    const oneWay = withSameStation({ ...opened, ret: LHR }, false);
    expect(zoneOfEnd(oneWay, "actualPickup")).toBe("Europe/Berlin");
    expect(zoneOfEnd(oneWay, "actualReturn")).toBe("Europe/London");
    expect(zoneOfEnd(opened, "actualReturn")).toBe("Europe/Berlin");
  });
});
