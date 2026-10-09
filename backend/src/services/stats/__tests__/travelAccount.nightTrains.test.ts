import { attributeTravelNights, buildTravelAccount, type AccountRail } from "../travelAccount";
import { buildTripAccount, type TripAccountInput } from "../tripAccount";

/**
 * forgejo#266. The account billed every night no record claimed as a night at
 * home, and it could not see a train at all: a Nightjet from Vienna to Hamburg
 * was a night "zuhause". Each case below is one of the issue's counter-probes —
 * a pure night-train user, an incomplete logbook, overlapping bookings, a year
 * change — plus the clock and calendar edges the rule has to survive. Every
 * instant names its station's zone, so the verdict does not depend on the
 * host's (the suite also runs under TZ=Pacific/Kiritimati and America/St_Johns).
 */

const NOW = new Date("2026-08-15T12:00:00Z");
let seq = 0;

const nightjet = (o: Partial<AccountRail> = {}): AccountRail => ({
  id: `ride-${(seq += 1)}`,
  status: "completed",
  trainCategory: "NJ",
  travelClass: "sleeper",
  // Wien Hbf 22:58 CET on 31 Dec -> Hamburg Hbf 09:00 CET on 1 Jan.
  departureTime: new Date("2025-12-31T21:58:00Z"),
  arrivalTime: new Date("2026-01-01T08:00:00Z"),
  depTimezone: "Europe/Vienna",
  arrTimezone: "Europe/Berlin",
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
  buildTravelAccount({ stays: [], cruises: [], flights: [], rail: [], now: NOW, ...o });

const year = (a: ReturnType<typeof buildTravelAccount>, y: string) =>
  a.years.find((row) => row.year === y)!;

describe("the travel account — night trains and the remainder (forgejo#266)", () => {
  it("a pure night-train user: the night is on the train, the rest is unassigned, never home", () => {
    const a = account({
      rail: [
        nightjet({
          departureTime: new Date("2025-05-05T20:58:00Z"),
          arrivalTime: new Date("2025-05-06T07:00:00Z"),
        }),
      ],
    });
    const y2025 = year(a, "2025");
    expect(y2025.railNights).toBe(1);
    expect(y2025.unassignedNights).toBe(364);
    expect(y2025).not.toHaveProperty("homeNights");
  });

  it("files a New Year's Eve night train under the old year, by the stations' calendars", () => {
    const a = account({ rail: [nightjet()] });
    expect(year(a, "2025").railNights).toBe(1);
    // The arrival day starts no night: 2026 holds no train night.
    expect(a.years.find((row) => row.year === "2026")?.railNights ?? 0).toBe(0);
  });

  it("an incomplete logbook leaves its gap unassigned — a missing hotel is not a night at home", () => {
    const a = account({
      stays: [stay("2025-07-01", "2025-07-04"), stay("2025-07-08", "2025-07-10")],
    });
    const y2025 = year(a, "2025");
    expect(y2025.hotelNights).toBe(5);
    expect(y2025.unassignedNights).toBe(360);
  });

  it("counts an overlapping night once, by the one stated precedence", () => {
    // Hotel booked for the night the Nightjet ran, a cruise over a hotel, and a
    // red-eye that left the evening the train arrived.
    const ride = nightjet({
      departureTime: new Date("2025-03-10T20:58:00Z"),
      arrivalTime: new Date("2025-03-11T07:00:00Z"),
    });
    const { nights } = attributeTravelNights({
      stays: [stay("2025-03-10", "2025-03-11")],
      cruises: [],
      flights: [],
      rail: [ride],
      now: NOW,
    });
    expect(nights).toHaveLength(1);
    expect(nights[0].awardedTo).toBe("hotel");
    expect(nights[0].claims).toEqual({ hotel: [expect.any(String)], rail: [ride.id] });
    expect(nights[0].contested).toBe(true);

    const a = account({
      stays: [stay("2025-03-10", "2025-03-11")],
      rail: [ride],
      flights: [
        {
          id: "red-eye",
          status: "flown",
          departureTime: new Date("2025-03-10T22:00:00Z"),
          arrivalTime: new Date("2025-03-11T06:00:00Z"),
          depLocalDay: new Date("2025-03-10T00:00:00Z"),
          arrLocalDay: new Date("2025-03-11T00:00:00Z"),
        },
      ],
    });
    const y2025 = year(a, "2025");
    expect([y2025.hotelNights, y2025.railNights, y2025.airNights]).toEqual([1, 0, 0]);
    expect(a.contestedNights).toBe(1);
    expect(
      y2025.hotelNights +
        y2025.seaNights +
        y2025.railNights +
        y2025.airNights +
        y2025.unassignedNights
    ).toBe(365);
  });

  it("gives a night claimed by a train and a flight to the train", () => {
    const { nights } = attributeTravelNights({
      stays: [],
      cruises: [],
      rail: [nightjet()],
      flights: [
        {
          id: "f",
          status: "flown",
          departureTime: new Date("2025-12-31T22:00:00Z"),
          arrivalTime: new Date("2026-01-01T03:00:00Z"),
          depLocalDay: new Date("2025-12-31T00:00:00Z"),
          arrLocalDay: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      now: NOW,
    });
    expect(nights.map((n) => n.awardedTo)).toEqual(["rail"]);
  });

  describe("unknown times", () => {
    // A date-only ride is stored at the start of its day on the station's clock.
    const dayOnly = (o: Partial<AccountRail>) =>
      nightjet({
        departureTime: new Date("2025-05-04T22:00:00Z"), // 5 May, 00:00 in Vienna
        arrivalTime: new Date("2025-05-05T22:00:00Z"), // 6 May, 00:00 in Berlin
        depPrecision: "day",
        arrPrecision: "day",
        ...o,
      });

    it("counts a date-only sleeper by its days", () => {
      expect(year(account({ rail: [dayOnly({})] }), "2025").railNights).toBe(1);
    });

    it("does not invent a night for a date-only ride with nothing saying it ran overnight", () => {
      const plain = dayOnly({ trainCategory: "ICE", travelClass: "second" });
      expect(account({ rail: [plain] }).years).toEqual([]);
    });

    it("reports a night train with no arrival day rather than placing its night", () => {
      const a = account({ rail: [nightjet({ arrivalTime: null })] });
      expect(a.years).toEqual([]);
      expect(a.undatedNightTrains).toBe(1);
    });

    it("keeps a midnight regional train out: crossing midnight is not a night", () => {
      const regional = nightjet({
        trainCategory: "RE",
        travelClass: "second",
        departureTime: new Date("2025-05-05T21:40:00Z"), // 23:40 Berlin
        arrivalTime: new Date("2025-05-05T22:20:00Z"), // 00:20 Berlin
        depTimezone: "Europe/Berlin",
      });
      expect(account({ rail: [regional] }).years).toEqual([]);
    });
  });

  describe("the running year and nights still to come", () => {
    it("counts no night that is not over, and no ride that has not happened", () => {
      const tonight = nightjet({
        departureTime: new Date("2026-08-15T20:58:00Z"),
        arrivalTime: new Date("2026-08-16T07:00:00Z"),
      });
      const booked = nightjet({
        status: "scheduled",
        departureTime: new Date("2026-09-01T20:58:00Z"),
        arrivalTime: new Date("2026-09-02T07:00:00Z"),
      });
      const cancelled = nightjet({
        status: "cancelled",
        departureTime: new Date("2026-03-01T20:58:00Z"),
        arrivalTime: new Date("2026-03-02T07:00:00Z"),
      });
      expect(account({ rail: [tonight, booked, cancelled] }).years).toEqual([]);
    });

    it("measures the running year up to last night", () => {
      const lastNight = nightjet({
        departureTime: new Date("2026-08-14T19:58:00Z"),
        arrivalTime: new Date("2026-08-15T07:00:00Z"),
      });
      const y2026 = year(account({ rail: [lastNight] }), "2026");
      expect(y2026.days).toBe(226);
      expect(y2026.railNights).toBe(1);
      expect(y2026.unassignedNights).toBe(225);
    });
  });
});

describe("a trip's coverage counts the night on the train", () => {
  it("covers the night a night train ran through", () => {
    const ride = {
      ...nightjet({
        departureTime: new Date("2025-06-01T20:58:00Z"),
        arrivalTime: new Date("2025-06-02T07:00:00Z"),
      }),
      price: null,
      currency: null,
      priceBase: null,
      fxBaseCurrency: null,
      bookingId: null,
      booking: null,
    };
    const trip: TripAccountInput = {
      id: "t",
      name: "Wien–Hamburg",
      startDate: new Date("2025-06-01T00:00:00Z"),
      endDate: new Date("2025-06-02T00:00:00Z"),
      status: "completed",
      category: null,
      tags: [],
      journalEntries: [],
      photoCount: 0,
      cost: {
        bookings: [],
        stays: [],
        cruises: [],
        flights: [],
        rail: [ride],
        rentals: [],
        expenses: [],
      },
      stays: [],
      cruises: [],
      flights: [],
      rail: [ride],
    };
    const row = buildTripAccount([trip]).trips[0];
    expect(row.coveredDays).toBe(1);
    expect(row.uncoveredDays).toBe(0);
  });
});
