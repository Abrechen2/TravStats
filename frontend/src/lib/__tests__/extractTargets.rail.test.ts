import { describe, it, expect, vi } from "vitest";

import { offeredFields, initialSelection } from "../extractValues";
import { railExtractTarget } from "../extractTargets";
import { makeRailJourney } from "../../components/rail/__tests__/railJourneyFixture";

/**
 * "Werte aus dem Beleg übernehmen" on a train ride: the leg is picked by its
 * train and its day on the station's clock, the rail fields are offered, and
 * the ticked values reach the ride under the rail column names.
 */
describe("railExtractTarget", () => {
  it("names the ride's train and departure day, and offers the rail fields it holds", () => {
    // 04:15 UTC is 06:15 in Frankfurt — still the 26th either way; the day
    // is read on the station's clock, not the browser's.
    const target = railExtractTarget(
      makeRailJourney({ price: null, travelClass: null, coach: "7", seat: null }),
      vi.fn()
    );
    expect(target).toMatchObject({
      domain: "rail",
      trainNumber: "ICE 696",
      departureDate: "2026-09-26",
    });
    const found = {
      price: 122.5,
      currency: "EUR",
      bookingReference: "Q7X2KT",
      seatNumber: "45",
      seatClass: null,
      travelClass: "second" as const,
      coach: "7",
    };
    const offered = offeredFields(found, target.current);
    // The coach it already holds is not offered again; a flight's seat class never is.
    expect(offered).toEqual(["price", "bookingReference", "seatNumber", "travelClass"]);
    expect(initialSelection(offered, target.current)).toEqual(offered);
  });

  it("writes the ticked values under the rail column names", async () => {
    const save = vi.fn(async () => undefined);
    const target = railExtractTarget(makeRailJourney(), save);
    await target.onApply({ price: 122.5, seatNumber: "45", coach: "7", travelClass: "second" });
    expect(save).toHaveBeenCalledWith({
      price: 122.5,
      seat: "45",
      coach: "7",
      travelClass: "second",
    });
  });
});
