import { prisma } from "../../../db";
import type { EvidenceScope } from "../../../shared/evidence";
import { loadBusStats } from "../../bus/busStats";
import { resolveMetricEvidence } from "../metricEvidence";
import { assertSumInvariant } from "./invariants";

/**
 * forgejo#263 — the bus tab's hours, change time, longest ride and longest
 * pause open the rides behind them, and each list's value is the tab's own.
 */
const USER = "bustileevidence";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const Y2025: EvidenceScope = { period: { kind: "year", year: 2025 } };
const PAGE = { offset: 0, limit: 50 };
type Ride = Parameters<typeof prisma.busJourney.create>[0]["data"];

const STOPS = [
  { name: "Hamburg ZOB", lat: 53.5527, lon: 10.0102, cc: "DE" },
  { name: "Berlin ZOB", lat: 52.5073, lon: 13.2797, cc: "DE" },
  { name: "Praha Florenc", lat: 50.0897, lon: 14.4397, cc: "CZ" },
];

describe("bus tile evidence", () => {
  let userId: string;
  const add = (from: number, to: number, dep: string, arr: string, over: Partial<Ride> = {}) =>
    prisma.busJourney.create({
      data: {
        userId,
        depStationName: STOPS[from].name,
        depLat: STOPS[from].lat,
        depLon: STOPS[from].lon,
        depCountry: STOPS[from].cc,
        depTimezone: "Europe/Berlin",
        arrStationName: STOPS[to].name,
        arrLat: STOPS[to].lat,
        arrLon: STOPS[to].lon,
        arrCountry: STOPS[to].cc,
        arrTimezone: "Europe/Berlin",
        departureTime: new Date(dep),
        arrivalTime: new Date(arr),
        depPrecision: "minute",
        arrPrecision: "minute",
        status: "completed",
        ...over,
      } as Ride,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    const booking = await prisma.booking.create({ data: { userId } });
    // 2024: Hamburg → Berlin, 3 h, 255 km.
    await add(0, 1, "2024-03-01T07:00Z", "2024-03-01T10:00Z", { distanceKm: 255 });
    // 2025: Hamburg → Berlin → Praha on one booking, one change of 30 min at Berlin.
    await add(0, 1, "2025-05-01T07:00Z", "2025-05-01T10:00Z", { bookingId: booking.id });
    await add(1, 2, "2025-05-01T10:30Z", "2025-05-01T15:00Z", {
      bookingId: booking.id,
      distanceKm: 350,
    });
    // A date-only ride: no hours on board.
    await add(2, 1, "2025-06-01T00:00Z", "2025-06-01T00:00Z", {
      depPrecision: "day",
      arrPrecision: "day",
    });
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  const resolve = async (key: string, scope: EvidenceScope) => {
    const res = await resolveMetricEvidence(userId, key, scope, PAGE);
    if (!res) throw new Error(`${key} is not served`);
    assertSumInvariant(res, Math.round);
    return res;
  };

  it("lists the timed rides behind the hours on board", async () => {
    const tab = await loadBusStats(userId, 2025);
    const hours = await resolve("busHoursOnBoard", Y2025);
    expect(hours.measure.value).toBe(Math.round(tab.hoursOnBoard.hours * 10) / 10);
    expect(hours.measure.value).toBe(7.5);
    expect(hours.entries).toHaveLength(tab.hoursOnBoard.measuredRides);
  });

  it("lists the journeys whose changes the change time averages", async () => {
    const tab = await loadBusStats(userId, 2025);
    const changes = await resolve("busTransferCount", Y2025);
    expect(changes.measure.value).toBe(tab.transfers.count);
    expect(changes.measure.value).toBe(1);
    expect(changes.entries[0]?.title.text).toBe("Hamburg ZOB → Praha Florenc");
  });

  it("names the ride holding the longest-ride record, per period", async () => {
    expect((await resolve("busLongestRide", ALL)).measure.value).toBe(350);
    const y2024 = await resolve("busLongestRide", { period: { kind: "year", year: 2024 } });
    expect(y2024.measure.value).toBe((await loadBusStats(userId, 2024)).longest?.distanceKm);
  });

  it("names the ride that came back after the longest pause — a lifetime figure", async () => {
    const tab = await loadBusStats(userId, null);
    const pause = await resolve("busLongestReturn", ALL);
    expect(pause.measure.value).toBe(tab.longestReturn?.days);
    // Hamburg left on 2024-03-01 and again on 2025-05-01: 426 days away.
    expect(pause.measure.value).toBe(426);
    expect(pause.entries).toHaveLength(1);
    await expect(resolveMetricEvidence(userId, "busLongestReturn", Y2025, PAGE)).rejects.toThrow(
      /allTime only/
    );
  });
});
