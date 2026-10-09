import { describe, it, expect } from "@jest/globals";

import {
  checkRailAchievement,
  foldRailAchievementStats,
  type RailBadgeRow,
} from "../railAchievements";
import { achievements } from "../../data/achievements";

/**
 * forgejo#261 — the three rail badges about HOW the user rides. Pure fold
 * over hand-built rides; the progress follows the live rides, so a removed
 * ride takes a badge with it (owner ruling 2026-09-20).
 */
let seq = 0;
function ride(over: Partial<RailBadgeRow>): RailBadgeRow {
  seq += 1;
  return {
    id: `r-${String(seq).padStart(4, "0")}`,
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    trainNumber: null,
    travelClass: null,
    depStationName: "Köln Hbf",
    arrStationName: "Basel SBB",
    depStationCode: "8000207",
    arrStationCode: "8500010",
    depStationId: 1,
    arrStationId: 4,
    depLat: 50.9432,
    depLon: 6.9586,
    arrLat: 47.5476,
    arrLon: 7.5897,
    bookingId: null,
    depCountry: "DE",
    arrCountry: "CH",
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Zurich",
    departureTime: new Date("2025-03-01T07:00Z"),
    arrivalTime: new Date("2025-03-01T11:00Z"),
    depPrecision: "minute",
    arrPrecision: "minute",
    distanceKm: 400,
    ...over,
  };
}

const badge = (code: string) => {
  const found = achievements.find((a) => a.code === code);
  if (!found) throw new Error(`no seed ${code}`);
  return found;
};

describe("Bahnhofs-Wiedersehen", () => {
  it("measures whole years between two visits of one station, by its own calendar", () => {
    const early = ride({
      departureTime: new Date("2019-05-04T07:00Z"),
      arrivalTime: new Date("2019-05-04T11:00Z"),
    });
    const late = ride({
      depStationName: "Basel SBB",
      depStationCode: "8500010",
      arrStationName: "Frankfurt (Main) Hbf",
      arrStationCode: "8000105",
      departureTime: new Date("2024-05-04T07:00Z"),
      arrivalTime: new Date("2024-05-04T10:00Z"),
    });
    const stats = foldRailAchievementStats([early, late]);
    expect(stats.railStationReturnYears).toBe(5);
    expect(checkRailAchievement(badge("RAIL_STATION_REUNION"), stats)?.isUnlocked).toBe(true);
    // A day short of five years is four.
    const shy = { ...late, departureTime: new Date("2024-05-03T07:00Z") };
    expect(foldRailAchievementStats([early, shy]).railStationReturnYears).toBe(4);
  });
});

describe("Gut umgestiegen", () => {
  const journey = (booking: string, day: string, over: Partial<RailBadgeRow> = {}) => [
    ride({
      bookingId: booking,
      arrStationName: "Frankfurt (Main) Hbf",
      arrStationCode: "8000105",
      arrStationId: 2,
      arrLat: 50.1071,
      arrLon: 8.6632,
      departureTime: new Date(`${day}T07:00Z`),
      arrivalTime: new Date(`${day}T08:05Z`),
    }),
    ride({
      bookingId: booking,
      depStationName: "Frankfurt (Main) Hbf",
      depStationCode: "8000105",
      depStationId: 2,
      depLat: 50.1071,
      depLon: 8.6632,
      departureTime: new Date(`${day}T08:20Z`),
      arrivalTime: new Date(`${day}T11:10Z`),
      ...over,
    }),
  ];

  it("counts five documented journeys with a linked change, and loses the badge with one of them", () => {
    const rides = ["01", "02", "03", "04", "05"].flatMap((d) => journey(`b${d}`, `2025-04-${d}`));
    const stats = foldRailAchievementStats(rides);
    expect(stats.railDocumentedTransferJourneys).toBe(5);
    expect(checkRailAchievement(badge("RAIL_TRANSFERS_5"), stats)?.isUnlocked).toBe(true);
    const fewer = foldRailAchievementStats(rides.slice(2));
    expect(checkRailAchievement(badge("RAIL_TRANSFERS_5"), fewer)).toEqual({
      isUnlocked: false,
      progress: 4,
    });
  });

  it("does not count a change between rides of no booking, nor a journey with a date-only end", () => {
    const unlinked = journey("x", "2025-05-01").map((r) => ({ ...r, bookingId: null }));
    const dateOnly = journey("y", "2025-05-02", { arrPrecision: "day" });
    expect(
      foldRailAchievementStats([...unlinked, ...dateOnly]).railDocumentedTransferJourneys
    ).toBe(0);
  });
});

describe("Neue Schienen", () => {
  it("takes the year with the most first-time connections; a connection ridden back is not new", () => {
    const stations = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
    const rides = stations.slice(1).map((to, i) =>
      ride({
        depStationName: "A",
        depStationCode: "A",
        arrStationName: to,
        arrStationCode: to,
        departureTime: new Date(`2025-06-${String(i + 1).padStart(2, "0")}T07:00Z`),
      })
    );
    const back = ride({
      depStationName: "B",
      depStationCode: "B",
      arrStationName: "A",
      arrStationCode: "A",
      departureTime: new Date("2025-07-01T07:00Z"),
    });
    const stats = foldRailAchievementStats([...rides, back]);
    expect(stats.railNewConnectionsYearMax).toBe(10);
    expect(checkRailAchievement(badge("RAIL_NEW_CONNECTIONS_10"), stats)?.isUnlocked).toBe(true);
    expect(foldRailAchievementStats(rides.slice(1)).railNewConnectionsYearMax).toBe(9);
  });
});
