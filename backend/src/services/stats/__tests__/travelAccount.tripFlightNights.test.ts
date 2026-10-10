import { prisma } from "../../../db";
import { AVAILABLE_DOMAINS } from "../../../shared/domains";
import { loadTravelAccountData } from "../travelAccountData";
import { buildTravelAccount } from "../travelAccount";
import { buildTripAccount, type TripAccountInput } from "../tripAccount";

/**
 * forgejo#266 (comment of 09.10.): the year account and a trip's coverage
 * must agree on whether a flight took a night. The year account read local
 * days since AUD-079; the trip coverage still compared UTC days, so an evening
 * hop out of Los Angeles covered a night the year account never counted —
 * and a genuine local red-eye, on one UTC day, covered none.
 */
const EVERY_DOMAIN = new Set(AVAILABLE_DOMAINS);
const LA = "America/Los_Angeles";
const NY = "America/New_York";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("buildTripAccount — a flight's night is a LOCAL night", () => {
  const trip = (flight: TripAccountInput["flights"][number]): TripAccountInput => ({
    id: "t",
    name: "t",
    startDate: day("2025-06-01"),
    endDate: day("2025-06-02"),
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
    flights: [flight],
    rail: [],
  });

  it("an evening hop crossing only the UTC date covers no night", () => {
    const row = buildTripAccount([
      trip({
        status: "flown",
        departureTime: new Date("2025-06-01T23:30:00Z"),
        arrivalTime: new Date("2025-06-02T00:30:00Z"),
        depLocalDay: day("2025-06-01"),
        arrLocalDay: day("2025-06-01"),
      }),
    ]).trips[0];
    expect(row).toMatchObject({ coveredDays: 0, uncoveredDays: 1 });
  });

  it("a local red-eye on one UTC day covers its night", () => {
    const row = buildTripAccount([
      trip({
        status: "flown",
        departureTime: new Date("2025-06-02T06:30:00Z"),
        arrivalTime: new Date("2025-06-02T14:30:00Z"),
        depLocalDay: day("2025-06-01"),
        arrLocalDay: day("2025-06-02"),
      }),
    ]).trips[0];
    expect(row).toMatchObject({ coveredDays: 1, uncoveredDays: 0 });
  });
});

describe("travel account data — year account and trip coverage read one clock", () => {
  let userId: string;
  let eveningTrip: string;
  let redEyeTrip: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripFlightNightsTest" } });
    userId = (
      await prisma.user.create({ data: { username: "tripFlightNightsTest", passwordHash: "x" } })
    ).id;
    const mkTrip = async (name: string, from: string, to: string) =>
      (
        await prisma.trip.create({
          data: {
            userId,
            name,
            startDate: day(from),
            endDate: day(to),
            startDay: day(from),
            endDay: day(to),
            status: "completed",
          },
        })
      ).id;
    eveningTrip = await mkTrip("Evening hop", "2025-06-01", "2025-06-02");
    redEyeTrip = await mkTrip("Red-eye", "2025-07-01", "2025-07-02");
    const flight = (data: Record<string, unknown>) =>
      prisma.flight.create({
        data: {
          userId,
          status: "flown",
          depLat: 33.94,
          depLon: -118.41,
          arrLat: 37.62,
          arrLon: -122.38,
          depTimeSemantics: "UTC",
          arrTimeSemantics: "UTC",
          ...data,
        },
      });
    // LAX 16:30 → SFO 17:30 on 1 June, local: 23:30Z → 00:30Z.
    await flight({
      tripId: eveningTrip,
      flightNumber: "UA1",
      depIata: "LAX",
      arrIata: "SFO",
      departureTime: new Date("2025-06-01T23:30:00Z"),
      arrivalTime: new Date("2025-06-02T00:30:00Z"),
      depTimezone: LA,
      arrTimezone: LA,
    });
    // LAX 23:30 on 1 July → JFK 10:30 on 2 July, local: one UTC day.
    await flight({
      tripId: redEyeTrip,
      flightNumber: "UA2",
      depIata: "LAX",
      arrIata: "JFK",
      departureTime: new Date("2025-07-02T06:30:00Z"),
      arrivalTime: new Date("2025-07-02T14:30:00Z"),
      depTimezone: LA,
      arrTimezone: NY,
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("names the same nights in the year account and in the trips", async () => {
    const data = await loadTravelAccountData(userId, EVERY_DOMAIN);
    const year = buildTravelAccount(data).years.find((y) => y.year === "2025");
    expect(year?.airNights).toBe(1);

    const trips = buildTripAccount(data.trips).trips;
    expect(trips.find((t) => t.id === eveningTrip)).toMatchObject({ coveredDays: 0 });
    expect(trips.find((t) => t.id === redEyeTrip)).toMatchObject({ coveredDays: 1 });
  });
});
