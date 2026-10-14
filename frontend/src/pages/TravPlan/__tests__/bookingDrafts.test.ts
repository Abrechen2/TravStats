import { describe, it, expect } from "vitest";
import { bookingDrafts } from "../bookingDrafts";
import type { PlanView } from "../../../lib/api/travplan";
const plan = {
  state: { timezone: "Atlantic/Madeira", currency: "EUR", destination: "Madeira" },
} as PlanView;
describe("Planning import review", () => {
  it("reads the existing flight parser contract without assigning the destination zone to departure", () => {
    const rows = bookingDrafts(
      {
        domain: "flight",
        flights: [
          {
            flightNumber: "LH117",
            departureCode: "FRA",
            arrivalCode: "FNC",
            departureTime: "2026-11-12T10:30",
            arrivalTime: "2026-11-12T13:30",
            price: "249,99",
            currency: "EUR",
            pnr: "ABC123",
          },
        ],
      },
      plan
    );
    expect(rows[0]).toMatchObject({
      day: "2026-11-12",
      time: "10:30",
      arrivalTime: "13:30",
      originPlace: "FRA",
      place: "FNC",
      amount: 249.99,
      timezone: null,
    });
  });
  it("keeps unknown dates and ambiguous repeated multi-leg prices unknown", () => {
    const rows = bookingDrafts(
      {
        domain: "flight",
        flights: [
          { departureCode: "FRA", arrivalCode: "FNC", price: "500", pnr: "ABC123" },
          { departureCode: "FNC", arrivalCode: "FRA", price: "500", pnr: "ABC123" },
        ],
      },
      plan
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.day === null && r.amount === null)).toBe(true);
    expect(rows[0].details.unqualifiedPrice).toBe(500);
  });
  it("groups a package total once across separately reviewed flights and stays", () => {
    const rows = bookingDrafts(
      {
        domain: "package",
        package: {
          bookingReference: "PACKAGE",
          totalPrice: 2500,
          currency: "EUR",
          flights: [
            {
              date: "2026-11-12",
              depIata: "FRA",
              arrIata: "FNC",
              depTime: "09:00",
              arrTime: "12:00",
              arrDayOffset: 0,
            },
          ],
          stays: [{ name: "A hotel", checkIn: "2026-11-12", checkOut: "2026-11-19" }],
        },
      },
      plan
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].priceGroupId).toBe(rows[1].priceGroupId);
    expect(rows[0].arrivalDay).toBe("2026-11-12");
    expect(rows[1].kind).toBe("hotel");
  });
  it("reads cruise candidates rather than silently showing nothing", () => {
    expect(
      bookingDrafts(
        {
          domain: "cruise",
          cruises: [{ shipName: "Ship", startDate: "2026-11-12", endDate: "2026-11-19" }],
        },
        plan
      )[0]
    ).toMatchObject({ kind: "cruise", title: "Ship", overnight: true });
  });
  it("keeps an unqualified instant and a price without currency unknown", () => {
    const row = bookingDrafts(
      { domain: "flight", flights: [{ departureTime: "2026-11-12T00:30:00Z", price: "500" }] },
      plan
    )[0];
    expect(row).toMatchObject({ day: null, time: null, amount: null });
    expect(row.details.price).toBe("500");
  });
});
