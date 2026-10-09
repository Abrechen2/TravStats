import { describe, expect, it } from "vitest";
import { rentalReturnFacts, showsReturnCard } from "../rentalReturnCard";
import { makeRental } from "../../../components/rental/__tests__/rentalFixture";

// forgejo#240: the return card's facts are the RETURN station's, never the pickup's.
describe("rentalReturnFacts", () => {
  const oneWay = makeRental({
    oneWay: true,
    returnStationName: "München Flughafen",
    returnIata: "MUC",
    returnLat: 48.35,
    returnLon: 11.78,
  });

  it("navigates to the return station of a one-way rental, not the pickup", () => {
    const facts = rentalReturnFacts(oneWay);
    expect(facts.navigationUrl).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=48.35,11.78"
    );
    expect(facts.navigationUrl).not.toContain("50.03");
    expect(facts.station).toBe("München Flughafen");
  });

  it("has no link — and no stand-in — when the return station has no usable position", () => {
    const facts = rentalReturnFacts({ ...oneWay, returnLat: 0, returnLon: 0 });
    expect(facts.position).toBeNull();
    expect(facts.navigationUrl).toBeNull();
    const nan = rentalReturnFacts({ ...oneWay, returnLat: Number.NaN });
    expect(nan.navigationUrl).toBeNull();
  });

  it("says no notes rather than an empty string", () => {
    expect(rentalReturnFacts({ ...oneWay, notes: "   " }).notes).toBeNull();
    expect(rentalReturnFacts({ ...oneWay, notes: "Schlüssel einwerfen" }).notes).toBe(
      "Schlüssel einwerfen"
    );
  });

  it("belongs to a rental still to be returned", () => {
    expect(showsReturnCard({ status: "in_progress" })).toBe(true);
    expect(showsReturnCard({ status: "scheduled" })).toBe(true);
    expect(showsReturnCard({ status: "completed" })).toBe(false);
    expect(showsReturnCard({ status: "cancelled" })).toBe(false);
  });
});
