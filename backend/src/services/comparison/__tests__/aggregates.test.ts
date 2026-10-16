import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildLeaderboardSnapshot } from "../aggregates";
import type { LeaderboardScope } from "../../../schemas/comparison";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const ALL: LeaderboardScope = {
  groups: ["distance", "trips", "time", "places"],
  domains: ["ferry", "poi"],
  year: null,
};
let userId: string;
const ferry = (departure: string, distanceKm: number | null) => ({
  userId,
  depStationName: "Kiel",
  depLat: 54.32,
  depLon: 10.13,
  arrStationName: "Oslo",
  arrLat: 59.91,
  arrLon: 10.75,
  departureTime: new Date(departure),
  status: "completed",
  distanceKm,
});

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `lb-agg-${randomUUID()}`, passwordHash: "test-only" },
    })
  ).id;
  await prisma.ferryJourney.createMany({
    data: [
      ferry("2025-06-01T12:00:00Z", 670),
      ferry("2025-07-01T12:00:00Z", null),
      ferry("2024-05-01T12:00:00Z", 100),
    ],
  });
  await prisma.place.create({
    data: {
      userId,
      name: "Nidarosdom",
      lat: 63.43,
      lon: 10.4,
      visited: true,
      visits: { create: [{ userId, visitedAt: new Date("2025-06-03T10:00:00Z") }] },
    },
  });
});
beforeEach(() => {
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry", "poi"]);
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

it("counts ferry crossings and marks the km a lower bound when one has no distance", async () => {
  const s = await buildLeaderboardSnapshot(userId, ALL, 2025);
  expect(s).toMatchObject({ schema: "travstats-leaderboard", version: 1, year: 2025 });
  expect(s.metrics).toMatchObject({ ferryCrossings: 2, ferryKm: 670, placeVisits: 1, places: 1 });
  expect(s.partial).toEqual(["ferryKm"]);
});

it("leaves what the consent does not cover absent, never zero", async () => {
  const s = await buildLeaderboardSnapshot(
    userId,
    { groups: ["trips"], domains: ["ferry"], year: null },
    null
  );
  expect(s.metrics).toEqual({ ferryCrossings: 3 });
  expect(Object.keys(s.metrics)).not.toContain("ferryKm");
  expect(Object.keys(s.metrics)).not.toContain("placeVisits");
});

it("abstains from cross-domain figures when the consent leaves a visible domain out", async () => {
  jest.mocked(loadVisibleDomains).mockResolvedValue(["flight", "ferry", "poi"]);
  const s = await buildLeaderboardSnapshot(userId, { ...ALL, domains: ["ferry", "poi"] }, 2025);
  expect(s.metrics.daysAway).toBeNull();
  expect(s.metrics.countries).toBeNull();
});

it("marks the tour km a lower bound when a counted recording stopped at the import limit", async () => {
  const tour = await prisma.tripRoute.create({
    data: {
      userId,
      name: "Dovrefjell",
      mode: "foot",
      kind: "tour",
      activity: "hike",
      tourDate: new Date("2025-06-05T00:00:00Z"),
    },
  });
  await prisma.tripRouteTrack.create({
    data: {
      routeId: tour.id,
      source: "dawarich",
      startedAt: new Date("2025-06-05T08:00:00Z"),
      endedAt: new Date("2025-06-05T15:00:00Z"),
      geometry: [
        [9.5, 62.3],
        [9.6, 62.35],
      ],
      pointCount: 2,
      distanceKm: 20,
      truncated: true,
    },
  });
  jest.mocked(loadVisibleDomains).mockResolvedValue(["roadtrip"]);
  const s = await buildLeaderboardSnapshot(
    userId,
    { groups: ["distance", "trips"], domains: ["roadtrip"], year: null },
    2025
  );
  expect(s.metrics).toEqual({ tours: 1, tourKm: 20 });
  expect(s.partial).toEqual(["tourKm"]);
});

it("refuses a year the consent does not cover, including the lifetime view", async () => {
  const one = { ...ALL, year: 2024 };
  await expect(buildLeaderboardSnapshot(userId, one, 2025)).rejects.toMatchObject({
    code: "COMPARISON_YEAR_NOT_SHARED",
  });
  await expect(buildLeaderboardSnapshot(userId, one, null)).rejects.toMatchObject({
    code: "COMPARISON_YEAR_NOT_SHARED",
  });
  expect((await buildLeaderboardSnapshot(userId, one, 2024)).metrics.ferryCrossings).toBe(1);
});
