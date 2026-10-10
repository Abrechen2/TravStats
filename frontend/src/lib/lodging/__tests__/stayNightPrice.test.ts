import { describe, expect, it } from "vitest";
import { stayNightPrice } from "../stayNightPrice";

/** forgejo#178: 3 × 120 € room + 30 € breakfast + 12 € city tax = 402 €. */
describe("stayNightPrice", () => {
  it("keeps the room rate apart from the average and names the extras", () => {
    expect(stayNightPrice({ totalPrice: 402, pricePerNight: 120, nights: 3 })).toEqual({
      roomRate: 120,
      average: { total: 402, nights: 3, perNight: 134 },
      extras: 42,
    });
  });

  it("invents no average when the length of the stay is unknown", () => {
    expect(stayNightPrice({ totalPrice: 402, pricePerNight: 120, nights: null })).toEqual({
      roomRate: 120,
      average: null,
      extras: null,
    });
  });

  it("does not repeat the total for one night without a room rate", () => {
    expect(stayNightPrice({ totalPrice: 90, pricePerNight: null, nights: 1 }).average).toBeNull();
  });

  it("does not repeat the room rate when the average equals it", () => {
    expect(stayNightPrice({ totalPrice: 360, pricePerNight: 120, nights: 3 })).toEqual({
      roomRate: 120,
      average: null,
      extras: null,
    });
  });

  it("shows the average for a stay with a total and nights but no room rate", () => {
    expect(stayNightPrice({ totalPrice: 300, pricePerNight: null, nights: 2 })).toEqual({
      roomRate: null,
      average: { total: 300, nights: 2, perNight: 150 },
      extras: null,
    });
  });

  it("treats a free stay's zero as a price, not as missing", () => {
    expect(stayNightPrice({ totalPrice: 0, pricePerNight: null, nights: 2 }).average).toEqual({
      total: 0,
      nights: 2,
      perNight: 0,
    });
  });
});
