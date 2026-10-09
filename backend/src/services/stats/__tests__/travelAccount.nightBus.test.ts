import { attributeTravelNights, buildTravelAccount, type AccountBus } from "../travelAccount";
import { buildTripAccount, type TripAccountInput } from "../tripAccount";

/**
 * forgejo#263 — a night bus claims the night it ran through, by its clocks,
 * on the terminals' calendars; a hotel booked for the same night wins it (a
 * bed beats a seat); a date-only ride claims nothing; and the remainder is
 * still unassigned, never home.
 */
const NOW = new Date("2026-08-15T12:00:00Z");
let seq = 0;
const nightBus = (o: Partial<AccountBus> = {}): AccountBus => ({
  id: `bus-${(seq += 1)}`,
  status: "completed",
  // Berlin ZOB 22:30 CEST on 5 May -> Praha 06:30 on 6 May.
  departureTime: new Date("2025-05-05T20:30:00Z"),
  arrivalTime: new Date("2025-05-06T04:30:00Z"),
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Prague",
  depPrecision: "minute",
  arrPrecision: "minute",
  ...o,
});
const stay = (checkIn: string, checkOut: string) => ({
  id: `stay-${(seq += 1)}`,
  status: "completed",
  datePrecision: "DAY",
  nights: null,
  checkIn: new Date(`${checkIn}T00:00:00Z`),
  checkOut: new Date(`${checkOut}T00:00:00Z`),
});
const account = (o: Partial<Parameters<typeof buildTravelAccount>[0]> = {}) =>
  buildTravelAccount({ stays: [], cruises: [], flights: [], now: NOW, ...o });
const year = (a: ReturnType<typeof buildTravelAccount>, y: string) =>
  a.years.find((row) => row.year === y)!;

describe("the travel account — night buses (forgejo#263)", () => {
  it("puts the night on the bus and leaves the rest unassigned", () => {
    const y2025 = year(account({ bus: [nightBus()] }), "2025");
    expect(y2025.busNights).toBe(1);
    expect(y2025.unassignedNights).toBe(364);
  });

  it("gives a night a hotel also claims to the hotel, and says it was contested", () => {
    const a = account({ bus: [nightBus()], stays: [stay("2025-05-05", "2025-05-06")] });
    expect(year(a, "2025")).toMatchObject({ hotelNights: 1, busNights: 0 });
    expect(a.contestedNights).toBe(1);
  });

  it("claims no night for a date-only ride, a cancelled one, or one not over yet", () => {
    const a = attributeTravelNights({
      stays: [],
      cruises: [],
      flights: [],
      now: NOW,
      bus: [
        nightBus({ depPrecision: "day", arrPrecision: "day" }),
        nightBus({ status: "cancelled" }),
        nightBus({
          departureTime: new Date("2026-08-15T20:30:00Z"),
          arrivalTime: new Date("2026-08-16T04:30:00Z"),
        }),
      ],
    });
    expect(a.nights).toEqual([]);
  });

  it("covers the trip's night it ran through", () => {
    const trip: TripAccountInput = {
      id: "t",
      name: "Prag",
      startDate: new Date("2025-05-05T00:00:00Z"),
      endDate: new Date("2025-05-06T00:00:00Z"),
      status: "completed",
      category: null,
      tags: [],
      journalEntries: [],
      photoCount: 0,
      cost: {
        bookings: [],
        flights: [],
        cruises: [],
        stays: [],
        rail: [],
        rentals: [],
        expenses: [],
      },
      stays: [],
      cruises: [],
      flights: [],
      rail: [],
      bus: [nightBus()],
    };
    expect(buildTripAccount([trip]).trips[0]).toMatchObject({ coveredDays: 1, uncoveredDays: 0 });
  });
});
