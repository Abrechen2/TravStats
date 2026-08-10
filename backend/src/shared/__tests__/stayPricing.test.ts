import { deriveStayTotalPrice, nightsBetween } from "../stayPricing";

describe("stayPricing.nightsBetween", () => {
  it("counts whole nights", () => {
    expect(nightsBetween("2026-05-01", "2026-05-04")).toBe(3);
  });
  it("survives a DST hour without losing a night (rounds)", () => {
    // 2 nights across a spring-forward-ish 47h span still reads as 2.
    expect(nightsBetween("2026-03-28T00:00:00Z", "2026-03-30T00:00:00Z")).toBe(2);
  });
  it("is 0 when a date is missing", () => {
    expect(nightsBetween(null, "2026-05-04")).toBe(0);
    expect(nightsBetween("2026-05-01", undefined)).toBe(0);
  });
});

describe("stayPricing.deriveStayTotalPrice", () => {
  it("keeps a typed total as the source of truth", () => {
    expect(
      deriveStayTotalPrice({ totalPrice: 420, pricePerNight: 100, checkIn: "2026-05-01", checkOut: "2026-05-04" })
    ).toBe(420);
  });

  // A package rate is not nights × rack rate — the typed total wins even when
  // it disagrees with the per-night figure.
  it("prefers the total even when it disagrees with per-night × nights", () => {
    expect(
      deriveStayTotalPrice({ totalPrice: 399, pricePerNight: 100, checkIn: "2026-05-01", checkOut: "2026-05-04" })
    ).toBe(399);
  });

  it("derives the total from per-night × nights when no total was given", () => {
    expect(
      deriveStayTotalPrice({ totalPrice: null, pricePerNight: 95, checkIn: "2026-07-26", checkOut: "2026-07-28" })
    ).toBe(190);
  });

  it("returns null for per-night without dates", () => {
    expect(deriveStayTotalPrice({ totalPrice: null, pricePerNight: 95 })).toBeNull();
  });

  it("returns null when nothing is priced", () => {
    expect(deriveStayTotalPrice({ totalPrice: null, pricePerNight: null })).toBeNull();
  });
});
