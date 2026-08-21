import { expectedLegCount } from "../backfillCruiseLegs";

describe("expectedLegCount", () => {
  it("counts departure + port calls + arrival, like recomputeLegsForCruise", () => {
    expect(
      expectedLegCount({
        departurePortId: 1,
        arrivalPortId: 4,
        stops: [{ portId: 2 }, { portId: 3 }],
      }),
    ).toBe(3); // 1 → 2 → 3 → 4
  });

  it("does not double-count a departure port repeated as the first stop", () => {
    expect(
      expectedLegCount({
        departurePortId: 1,
        arrivalPortId: 1,
        stops: [{ portId: 1 }, { portId: 2 }, { portId: 1 }],
      }),
    ).toBe(2); // 1 → 2 → 1
  });

  it("gives one leg to a cruise whose itinerary is only departure and arrival", () => {
    expect(
      expectedLegCount({ departurePortId: 1, arrivalPortId: 2, stops: [] }),
    ).toBe(1);
  });

  it("ignores stops without a port", () => {
    expect(
      expectedLegCount({
        departurePortId: 1,
        arrivalPortId: 3,
        stops: [{ portId: null }, { portId: 2 }, { portId: null }],
      }),
    ).toBe(2); // 1 → 2 → 3
  });

  it("gives zero legs when there is nothing to connect", () => {
    expect(
      expectedLegCount({ departurePortId: null, arrivalPortId: null, stops: [] }),
    ).toBe(0);
  });
});
