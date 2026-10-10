import { prisma } from "../../../db";
import type { EvidenceScope } from "../../../shared/evidence";
import { calculateRailAchievementStats } from "../../../utils/railAchievements";
import { loadRailStats } from "../../rail/railStats";
import { resolveMetricEvidence } from "../metricEvidence";
import { assertSumInvariant } from "./invariants";

/**
 * forgejo#261 — the rail tab's journey figures list the rides behind them,
 * and each list's value is the tab's own number (and the badge's, where a
 * badge stands on it).
 */
const USER = "railjourneyevidence";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const Y2025: EvidenceScope = { period: { kind: "year", year: 2025 } };
const PAGE = { offset: 0, limit: 50 };

type Ride = Parameters<typeof prisma.railJourney.create>[0]["data"];

const KOELN = { name: "Köln Hbf", code: "8000207", lat: 50.9432, lon: 6.9586, tz: "Europe/Berlin" };
const FRA = {
  name: "Frankfurt (Main) Hbf",
  code: "8000105",
  lat: 50.1071,
  lon: 8.6632,
  tz: "Europe/Berlin",
};
const BASEL = {
  name: "Basel SBB",
  code: "8500010",
  lat: 47.5476,
  lon: 7.5897,
  tz: "Europe/Zurich",
};
const WIEN = { name: "Wien Hbf", code: "8103000", lat: 48.185, lon: 16.3769, tz: "Europe/Vienna" };

describe("rail journey evidence", () => {
  let userId: string;

  const add = (
    from: typeof KOELN,
    to: typeof KOELN,
    dep: string,
    arr: string,
    over: Partial<Ride> = {}
  ) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: from.name,
        depStationCode: from.code,
        depLat: from.lat,
        depLon: from.lon,
        depTimezone: from.tz,
        arrStationName: to.name,
        arrStationCode: to.code,
        arrLat: to.lat,
        arrLon: to.lon,
        arrTimezone: to.tz,
        departureTime: new Date(dep),
        arrivalTime: new Date(arr),
        status: "completed",
        ...over,
      } as Ride,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    const booking = await prisma.booking.create({ data: { userId } });
    // 2024: Köln → Basel, the first ride on that connection.
    await add(KOELN, BASEL, "2024-05-01T07:00Z", "2024-05-01T11:00Z", { distanceKm: 430 });
    // 2025: Köln → Frankfurt → Basel on one booking — one journey, one change.
    await add(KOELN, FRA, "2025-03-01T07:00Z", "2025-03-01T08:05Z", { bookingId: booking.id });
    await add(FRA, BASEL, "2025-03-01T08:20Z", "2025-03-01T11:10Z", { bookingId: booking.id });
    // 2025: a Nightjet Basel → Wien, one night on board.
    await add(BASEL, WIEN, "2025-06-01T19:00Z", "2025-06-02T07:00Z", {
      trainCategory: "NJ",
      distanceKm: 820,
    });
    // A cancelled ride is never anywhere.
    await add(WIEN, KOELN, "2025-07-01T07:00Z", "2025-07-01T17:00Z", { status: "cancelled" });
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

  it("lists the journeys the rail tab counts — a change of trains is one", async () => {
    const tab = await loadRailStats(userId, null);
    const journeys = await resolve("railJourneyCount", ALL);
    expect(journeys.measure.value).toBe(tab.connected.journeys.total);
    expect(journeys.measure.value).toBe(3);
    expect(journeys.entries.map((e) => e.title.text)).toContain("Köln Hbf → Basel SBB");

    const documented = await resolve("railDocumentedTransferJourneyCount", ALL);
    const badge = await calculateRailAchievementStats(userId);
    expect(documented.measure.value).toBe(badge.railDocumentedTransferJourneys);
    expect(documented.measure.value).toBe(1);
  });

  it("names the night train behind the nights on board", async () => {
    const tab = await loadRailStats(userId, 2025);
    const nights = await resolve("railNightTrainNights", Y2025);
    expect(nights.measure.value).toBe(tab.connected.nightTrainNights.nights);
    expect(nights.measure.value).toBe(1);
    expect(nights.entries).toHaveLength(1);
  });

  it("files a connection as new in the year of its first ride", async () => {
    const tab2025 = await loadRailStats(userId, 2025);
    const fresh2025 = await resolve("railNewConnectionsCount", Y2025);
    expect(fresh2025.measure.value).toBe(tab2025.connected.newConnections.inScope);
    // Köln–Frankfurt, Frankfurt–Basel and Basel–Wien are new in 2025; Köln–Basel is not.
    expect(fresh2025.measure.value).toBe(3);
    const lifetime = await resolve("railNewConnectionsCount", ALL);
    expect(lifetime.measure.value).toBe(4);
  });

  it("lists the rides behind the hours on board, each with its own hours (forgejo#261)", async () => {
    const tab = await loadRailStats(userId, null);
    const hours = await resolve("railHoursOnBoard", ALL);
    expect(hours.measure.value).toBe(Math.round(tab.hoursOnBoard.hours * 10) / 10);
    expect(hours.measure.value).toBe(19.9);
    expect(hours.entries).toHaveLength(tab.hoursOnBoard.measuredJourneys);
    expect(hours.measure.unit).toBe("hours");
  });

  it("lists the journeys whose changes the average change time is taken over", async () => {
    const tab = await loadRailStats(userId, 2025);
    const changes = await resolve("railTransferCount", Y2025);
    expect(changes.measure.value).toBe(tab.connected.transfers.count);
    expect(changes.measure.value).toBe(1);
    expect(changes.entries.map((e) => e.title.text)).toEqual(["Köln Hbf → Basel SBB"]);
  });

  it("names the ride that holds the longest-ride record, per period", async () => {
    const lifetime = await resolve("railLongestRide", ALL);
    expect(lifetime.measure.value).toBe((await loadRailStats(userId, null)).longest?.distanceKm);
    expect(lifetime.measure.value).toBe(820);
    expect(lifetime.entries).toHaveLength(1);
    const y2024 = await resolve("railLongestRide", { period: { kind: "year", year: 2024 } });
    expect(y2024.measure.value).toBe(430);
  });
});
