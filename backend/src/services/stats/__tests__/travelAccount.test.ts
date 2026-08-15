import { buildTravelAccount } from "../travelAccount";
import { buildTripAccount, type TripAccountInput } from "../tripAccount";

const NOW = new Date("2026-08-15T12:00:00Z");
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const stay = (checkIn: string, checkOut: string, status = "completed") => ({
  status,
  checkIn: d(checkIn),
  checkOut: d(checkOut),
});

describe("buildTravelAccount", () => {
  it("closes out the year: every night is in exactly one bucket", () => {
    const account = buildTravelAccount({
      stays: [stay("2025-03-01", "2025-03-04")],
      cruises: [{ status: "flown", startDate: d("2025-06-01"), endDate: d("2025-06-08") }],
      flights: [
        {
          status: "flown",
          departureTime: new Date("2025-09-01T22:00:00Z"),
          arrivalTime: new Date("2025-09-02T08:00:00Z"),
        },
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
        {
          status: "flown",
          departureTime: new Date("2025-09-01T08:00:00Z"),
          arrivalTime: new Date("2025-09-01T11:00:00Z"),
        },
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
