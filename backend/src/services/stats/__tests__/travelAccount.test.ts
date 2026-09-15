import { buildTravelAccount } from "../travelAccount";
import { buildTripAccount, type TripAccountInput } from "../tripAccount";

const NOW = new Date("2026-08-15T12:00:00Z");
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const stay = (checkIn: string, checkOut: string, status = "completed") => ({
  status,
  checkIn: d(checkIn),
  checkOut: d(checkOut),
});

/** UTC midnight of the calendar day an ISO instant falls on, in UTC. */
const utcDay = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/**
 * A flight whose local days are simply its UTC days — an airport sitting in
 * UTC. Keeps every case written before AUD-079 reading exactly as it did; the
 * two below that care about the difference state their local days explicitly.
 */
const utcFlight = (departure: string, arrival: string, status = "flown") => {
  const departureTime = new Date(departure);
  const arrivalTime = new Date(arrival);
  return {
    status,
    departureTime,
    arrivalTime,
    depLocalDay: utcDay(departureTime),
    arrLocalDay: utcDay(arrivalTime),
  };
};

describe("buildTravelAccount", () => {
  it("closes out the year: every night is in exactly one bucket", () => {
    const account = buildTravelAccount({
      stays: [stay("2025-03-01", "2025-03-04")],
      cruises: [{ status: "flown", startDate: d("2025-06-01"), endDate: d("2025-06-08") }],
      flights: [
        utcFlight("2025-09-01T22:00:00Z", "2025-09-02T08:00:00Z"),
      ],
      now: NOW,
    });
    const y = account.years.find((r) => r.year === "2025")!;
    expect(y.hotelNights).toBe(3);
    expect(y.seaNights).toBe(7);
    expect(y.airNights).toBe(1);
    expect(y.hotelNights + y.seaNights + y.airNights + y.homeNights).toBe(365);
  });

  it("does not treat a daytime flight as a night in the air", () => {
    const account = buildTravelAccount({
      stays: [],
      cruises: [],
      flights: [
        utcFlight("2025-09-01T08:00:00Z", "2025-09-01T11:00:00Z"),
      ],
      now: NOW,
    });
    expect(account.years).toEqual([]);
  });

  it("gives a contested night to the cabin and says it was contested", () => {
    // A hotel booked over a night that was actually spent at sea. The
    // precedence is a convention; the count is what makes it visible.
    const account = buildTravelAccount({
      stays: [stay("2025-06-02", "2025-06-04")],
      cruises: [{ status: "flown", startDate: d("2025-06-01"), endDate: d("2025-06-08") }],
      now: NOW,
      flights: [],
    });
    const y = account.years.find((r) => r.year === "2025")!;
    expect(y.seaNights).toBe(7);
    expect(y.hotelNights).toBe(0);
    expect(account.contestedNights).toBe(2);
  });

  it("keeps a future booking out of the account", () => {
    const account = buildTravelAccount({
      stays: [stay("2026-12-01", "2026-12-05", "scheduled")],
      cruises: [],
      flights: [],
      now: NOW,
    });
    expect(account.years).toEqual([]);
  });

  it("shortens the current year to the days elapsed", () => {
    const account = buildTravelAccount({
      stays: [stay("2026-01-01", "2026-01-11")],
      cruises: [],
      flights: [],
      now: NOW,
    });
    const y = account.years.find((r) => r.year === "2026")!;
    // 15 August is day 227 of 2026.
    expect(y.days).toBe(227);
    expect(y.homeNights).toBe(217);
  });

  it("fills a year with no travel at all rather than leaving a hole", () => {
    // A gap year drawn as missing reads as "no data"; drawn as all-home it
    // reads as what actually happened.
    const account = buildTravelAccount({
      stays: [stay("2023-05-01", "2023-05-03"), stay("2025-05-01", "2025-05-03")],
      cruises: [],
      flights: [],
      now: NOW,
    });
    const y2024 = account.years.find((r) => r.year === "2024")!;
    expect(y2024.homeNights).toBe(366);
    expect(y2024.hotelNights).toBe(0);
  });

  it("returns nothing rather than a zero row when there is no data at all", () => {
    const account = buildTravelAccount({ stays: [], cruises: [], flights: [], now: NOW });
    expect(account.years).toEqual([]);
    expect(account.contestedNights).toBe(0);
  });

  /**
   * AUD-079. Whether a flight took a night is a question about the clocks at
   * either end. Deciding it on the stored UTC instants gets both of these
   * exactly backwards — and they are each other's mirror, so a fix that merely
   * shifted the boundary rather than reading the local day fails one of them.
   */
  describe("a night in the air is a night on the local clocks", () => {
    // LAX -> SFO, 16:30 to 17:30 local on 1 June. In UTC that is
    // 23:30 to 00:30, i.e. across a UTC date boundary.
    const eveningHop = {
      status: "flown",
      departureTime: new Date("2025-06-01T23:30:00Z"),
      arrivalTime: new Date("2025-06-02T00:30:00Z"),
      depLocalDay: d("2025-06-01"),
      arrLocalDay: d("2025-06-01"),
    };

    // The mirror: 23:30 to 00:30 LOCAL, which is 06:30 to 07:30 UTC on one
    // and the same UTC day — a genuine night, invisible to a UTC comparison.
    const redEye = {
      status: "flown",
      departureTime: new Date("2025-06-02T06:30:00Z"),
      arrivalTime: new Date("2025-06-02T07:30:00Z"),
      depLocalDay: d("2025-06-01"),
      arrLocalDay: d("2025-06-02"),
    };

    it("does not bill an evening hop as a night in the plane", () => {
      const account = buildTravelAccount({
        stays: [],
        cruises: [],
        flights: [eveningHop],
        now: NOW,
      });
      // No night anywhere means no year row at all — the same answer the
      // account gives for a daytime hop.
      expect(account.years).toEqual([]);
    });

    it("does bill a real red-eye, even though it sits inside one UTC day", () => {
      const account = buildTravelAccount({
        stays: [],
        cruises: [],
        flights: [redEye],
        now: NOW,
      });
      const y = account.years.find((r) => r.year === "2025");
      expect(y?.airNights).toBe(1);
    });
  });
});

/** A trip flight with the full cost shape, defaulting to "nothing recorded". */
const costFlight = (o: Partial<TripAccountInput["flights"][number]> = {}) => ({
  status: "flown",
  departureTime: null,
  arrivalTime: null,
  price: null,
  taxes: null,
  fees: null,
  currency: null,
  priceBase: null,
  fxBaseCurrency: null,
  bookingId: null,
  booking: null,
  ...o,
});

const trip = (o: Partial<TripAccountInput> = {}): TripAccountInput => ({
  id: "t1",
  name: "Norwegen",
  startDate: d("2025-06-01"),
  endDate: d("2025-06-08"),
  status: "completed",
  category: "vacation",
  tags: [],
  journalEntries: [],
  photoCount: 0,
  stays: [],
  cruises: [],
  flights: [],
  ...o,
});

describe("buildTripAccount", () => {
  it("counts the days of a trip with no night recorded anywhere", () => {
    const account = buildTripAccount([
      trip({
        stays: [
          {
            ...stay("2025-06-01", "2025-06-04"),
            totalPrice: 300,
            currency: "EUR",
            totalPriceBase: 300,
            fxBaseCurrency: "EUR",
          },
        ],
      }),
    ]);
    const row = account.trips[0];
    expect(row.days).toBe(7);
    expect(row.coveredDays).toBe(3);
    expect(row.uncoveredDays).toBe(4);
    expect(account.totalUncoveredDays).toBe(4);
    expect(account.fullyCoveredTrips).toBe(0);
  });

  it("counts a trip as fully covered when every travelling day is accounted for", () => {
    const account = buildTripAccount([
      trip({
        cruises: [
          {
            status: "flown",
            startDate: d("2025-06-01"),
            endDate: d("2025-06-08"),
            price: 2400,
            currency: "EUR",
          },
        ],
      }),
    ]);
    expect(account.trips[0].uncoveredDays).toBe(0);
    expect(account.fullyCoveredTrips).toBe(1);
  });

  it("keeps currencies apart instead of inventing a rate for flights and cruises", () => {
    // Only lodging carries an FX snapshot. Summing these would mean picking a
    // rate, at a date nobody recorded, for two of the three amounts.
    const account = buildTripAccount([
      trip({
        stays: [
          {
            ...stay("2025-06-01", "2025-06-04"),
            totalPrice: 300,
            currency: "EUR",
            totalPriceBase: 300,
            fxBaseCurrency: "EUR",
          },
        ],
        cruises: [
          {
            status: "flown",
            startDate: d("2025-06-04"),
            endDate: d("2025-06-08"),
            price: 500,
            currency: "CHF",
          },
        ],
        flights: [
          {
            status: "flown",
            departureTime: new Date("2025-06-01T08:00:00Z"),
            arrivalTime: new Date("2025-06-01T11:00:00Z"),
            price: 120,
            currency: "EUR",
          },
        ],
      }),
    ]);
    expect(account.trips[0].spendByCurrency).toEqual({ EUR: 420, CHF: 500 });
    // Only the lodging slice has a snapshot behind it.
    expect(account.trips[0].spendBaseByCurrency).toEqual({ EUR: 300 });
  });

  it("leaves coverage unanswered for a trip with no dates rather than guessing", () => {
    const account = buildTripAccount([trip({ startDate: null, endDate: null })]);
    expect(account.trips[0].days).toBeNull();
    expect(account.trips[0].uncoveredDays).toBeNull();
    expect(account.tripsWithDates).toBe(0);
    expect(account.avgTripDays).toBeNull();
  });

  it("buckets a category-less trip as unassigned instead of dropping it", () => {
    const account = buildTripAccount([trip({ category: null })]);
    expect(account.byCategory).toEqual([{ key: "unassigned", trips: 1, days: 7 }]);
  });

  it("counts journal moods and weather across every trip", () => {
    const account = buildTripAccount([
      trip({
        journalEntries: [
          { mood: "happy", weather: "sun" },
          { mood: "happy", weather: "rain" },
          { mood: null, weather: null },
        ],
      }),
    ]);
    expect(account.journalEntries).toBe(3);
    expect(account.moods).toEqual([{ key: "happy", count: 2 }]);
    expect(account.weather.map((w) => w.key).sort()).toEqual(["rain", "sun"]);
  });

  it("ignores a cancelled stay's money and its days", () => {
    const account = buildTripAccount([
      trip({
        stays: [
          {
            ...stay("2025-06-01", "2025-06-04", "cancelled"),
            totalPrice: 999,
            currency: "EUR",
            totalPriceBase: 999,
            fxBaseCurrency: "EUR",
          },
        ],
      }),
    ]);
    expect(account.trips[0].spendByCurrency).toEqual({});
    expect(account.trips[0].coveredDays).toBe(0);
  });

  it("returns empty aggregates rather than NaN for no trips", () => {
    const account = buildTripAccount([]);
    expect(account.trips).toEqual([]);
    expect(account.avgTripDays).toBeNull();
    expect(account.longestTripDays).toBeNull();
    expect(account.byCategory).toEqual([]);
  });
});

/**
 * AUD-080. The trip account added `flight.price` and nothing else, so it
 * disagreed with the flight summary about what the same flights cost. Codex's
 * case: 430 EUR on the summary, 100 EUR on the travel account.
 */
describe("buildTripAccount — what a flight costs", () => {
  const BOOKING = { price: 300, currency: "EUR", priceBase: null, fxBaseCurrency: null };

  it("counts a shared booking once, not once per segment and not zero times", () => {
    const account = buildTripAccount([
      trip({
        flights: [
          // Both segments carry no own price — the money is on the booking.
          costFlight({ bookingId: "b1", booking: BOOKING }),
          costFlight({ bookingId: "b1", booking: BOOKING }),
        ],
      }),
    ]);

    expect(account.trips[0]!.spendByCurrency).toEqual({ EUR: 300 });
  });

  it("includes taxes and fees in a flight's own price", () => {
    const account = buildTripAccount([
      trip({
        flights: [costFlight({ price: 100, taxes: 20, fees: 10, currency: "EUR" })],
      }),
    ]);

    expect(account.trips[0]!.spendByCurrency).toEqual({ EUR: 130 });
  });

  it("agrees with the flight summary on Codex's mixed case", () => {
    // Two segments on one 300 EUR booking, plus 100 + 20 + 10 on a third.
    const account = buildTripAccount([
      trip({
        flights: [
          costFlight({ bookingId: "b1", booking: BOOKING }),
          costFlight({ bookingId: "b1", booking: BOOKING }),
          costFlight({ price: 100, taxes: 20, fees: 10, currency: "EUR" }),
        ],
      }),
    ]);

    expect(account.trips[0]!.spendByCurrency).toEqual({ EUR: 430 });
  });

  it("counts a booking shared across two trips for both of them", () => {
    // Not a duplicate: it really is a cost of each trip, and suppressing it
    // for the second would understate that trip.
    const account = buildTripAccount([
      trip({ id: "t1", flights: [costFlight({ bookingId: "b1", booking: BOOKING })] }),
      trip({ id: "t2", flights: [costFlight({ bookingId: "b1", booking: BOOKING })] }),
    ]);

    expect(account.trips[0]!.spendByCurrency).toEqual({ EUR: 300 });
    expect(account.trips[1]!.spendByCurrency).toEqual({ EUR: 300 });
  });

  it("leaves a cancelled flight out entirely", () => {
    const account = buildTripAccount([
      trip({
        flights: [costFlight({ status: "cancelled", price: 100, taxes: 20, currency: "EUR" })],
      }),
    ]);

    expect(account.trips[0]!.spendByCurrency).toEqual({});
  });
});
