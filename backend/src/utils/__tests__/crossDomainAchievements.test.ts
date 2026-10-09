import { describe, it, expect } from "@jest/globals";

import {
  badgeDomainCounts,
  checkCrossDomainAchievement,
  foldCrossDomainAchievementStats,
  CROSS_DOMAIN_REQUIREMENT_TYPES,
  type CrossDomainTripRow,
} from "../crossDomainAchievements";
import { achievements } from "../../data/achievements";
import { achievementVisibility } from "../../services/achievementVisibility";

/**
 * forgejo#265 — the shared trip badges count only entries on the same trip
 * that really happened; a rental is no movement; a beta domain switched off
 * feeds nothing; and the fully documented trip now takes any mode.
 */
const NOW = new Date("2026-06-01T12:00:00Z");
const PAST = new Date("2026-03-01T00:00:00Z");
const LATER = new Date("2026-03-04T00:00:00Z");

const trip = (o: Partial<CrossDomainTripRow> = {}): CrossDomainTripRow => ({
  status: "completed",
  flights: [],
  cruises: [],
  railJourneys: [],
  busJourneys: [],
  lodgingStays: [],
  placeVisits: [],
  routes: [],
  _count: { journalEntries: 0, photos: 0 },
  ...o,
});
const done = [{ status: "flown" }];
const ride = [{ status: "completed" }];
const stayed = [{ status: "completed", checkIn: PAST, checkOut: LATER }];
const visited = [{ visitedAt: PAST, visitedAtUtc: PAST }];
const station = (startDate: Date | null) => ({
  lodgingStayId: null,
  overnight: false,
  startDate,
  endDate: null,
  lodgingStay: null,
});
const roadtrip = [{ stops: [station(PAST)] }];
const ALL_VISIBLE = badgeDomainCounts([
  "flight",
  "cruise",
  "lodging",
  "poi",
  "roadtrip",
  "rail",
  "rental",
  "bus",
]);
const BETA_OFF = badgeDomainCounts(["flight", "cruise", "lodging", "poi"]);

describe("three modes on one trip", () => {
  it("counts a completed trip that flew, took a train and drove a roadtrip", () => {
    const t = trip({ flights: done, railJourneys: ride, routes: roadtrip });
    expect(foldCrossDomainAchievementStats([t], ALL_VISIBLE, NOW).tripsThreeModes).toBe(1);
  });

  it("does not count modes spread over two trips, a planned roadtrip, or a running trip", () => {
    const split = [trip({ flights: done, railJourneys: ride }), trip({ busJourneys: ride })];
    expect(foldCrossDomainAchievementStats(split, ALL_VISIBLE, NOW).tripsThreeModes).toBe(0);
    const planned = trip({
      flights: done,
      railJourneys: ride,
      routes: [{ stops: [station(new Date("2027-01-01T00:00:00Z"))] }],
    });
    expect(foldCrossDomainAchievementStats([planned], ALL_VISIBLE, NOW).tripsThreeModes).toBe(0);
    const running = trip({
      status: "in_progress",
      flights: done,
      railJourneys: ride,
      busJourneys: ride,
    });
    expect(foldCrossDomainAchievementStats([running], ALL_VISIBLE, NOW).tripsThreeModes).toBe(0);
  });

  // Review I1: an empty or undated roadtrip draft moved nobody.
  it("does not count an empty or undated roadtrip as a mode of travel", () => {
    for (const routes of [[{ stops: [] }], [{ stops: [station(null)] }]]) {
      const t = trip({ flights: done, railJourneys: ride, routes });
      expect(foldCrossDomainAchievementStats([t], ALL_VISIBLE, NOW).tripsThreeModes).toBe(0);
    }
  });

  it("lets no beta domain that is switched off feed the badge", () => {
    const t = trip({ flights: done, railJourneys: ride, busJourneys: ride });
    expect(foldCrossDomainAchievementStats([t], ALL_VISIBLE, NOW).tripsThreeModes).toBe(1);
    expect(foldCrossDomainAchievementStats([t], BETA_OFF, NOW).tripsThreeModes).toBe(0);
  });
});

describe("arrive and discover", () => {
  it("needs a train or coach, a stay that is over and a place visit, on one trip", () => {
    const full = trip({ busJourneys: ride, lodgingStays: stayed, placeVisits: visited });
    expect(foldCrossDomainAchievementStats([full], ALL_VISIBLE, NOW).tripsArriveAndDiscover).toBe(
      1
    );
    const flown = trip({ flights: done, lodgingStays: stayed, placeVisits: visited });
    expect(foldCrossDomainAchievementStats([flown], ALL_VISIBLE, NOW).tripsArriveAndDiscover).toBe(
      0
    );
    const planned = trip({
      railJourneys: [{ status: "scheduled" }],
      lodgingStays: stayed,
      placeVisits: visited,
    });
    expect(
      foldCrossDomainAchievementStats([planned], ALL_VISIBLE, NOW).tripsArriveAndDiscover
    ).toBe(0);
  });
});

describe("the fully documented trip", () => {
  const documented = { lodgingStays: stayed, _count: { journalEntries: 2, photos: 5 } };

  it("takes a journey by train now, not only by plane or ship", () => {
    const byTrain = trip({ ...documented, railJourneys: ride });
    expect(foldCrossDomainAchievementStats([byTrain], ALL_VISIBLE, NOW).tripsFullyDocumented).toBe(
      1
    );
    const byPlane = trip({ ...documented, flights: done });
    expect(foldCrossDomainAchievementStats([byPlane], BETA_OFF, NOW).tripsFullyDocumented).toBe(1);
  });

  // Review I1: "Lückenlos festgehalten" needs a real movement, not an empty roadtrip section.
  it("does not count a trip whose only 'movement' is an empty or undated roadtrip", () => {
    for (const routes of [[{ stops: [] }], [{ stops: [station(null)] }]]) {
      const t = trip({ ...documented, routes });
      expect(foldCrossDomainAchievementStats([t], ALL_VISIBLE, NOW).tripsFullyDocumented).toBe(0);
    }
    const driven = trip({ ...documented, routes: roadtrip });
    expect(foldCrossDomainAchievementStats([driven], ALL_VISIBLE, NOW).tripsFullyDocumented).toBe(
      1
    );
  });

  it("does not count a trip whose only movement is hidden, nor one without photos", () => {
    const byTrain = trip({ ...documented, railJourneys: ride });
    expect(foldCrossDomainAchievementStats([byTrain], BETA_OFF, NOW).tripsFullyDocumented).toBe(0);
    const noPhotos = trip({
      ...documented,
      flights: done,
      _count: { journalEntries: 1, photos: 0 },
    });
    expect(foldCrossDomainAchievementStats([noPhotos], ALL_VISIBLE, NOW).tripsFullyDocumented).toBe(
      0
    );
  });
});

describe("the shared trip badges in the catalogue", () => {
  it("are answered by this module and hidden while no beta domain that can earn them is visible", () => {
    for (const code of ["TRIP_THREE_MODES", "TRIP_ARRIVE_DISCOVER", "DOCUMENTED_TRIP_1"]) {
      const seed = achievements.find((a) => a.code === code)!;
      expect(seed.domain).toBe("shared");
      expect(CROSS_DOMAIN_REQUIREMENT_TYPES).toContain(seed.requirementType);
      expect(
        checkCrossDomainAchievement(seed, {
          tripsThreeModes: 1,
          tripsArriveAndDiscover: 1,
          tripsFullyDocumented: 1,
        })?.isUnlocked
      ).toBe(true);
    }
    const betaOff = achievementVisibility(["flight", "cruise", "lodging", "poi"]);
    expect(betaOff("shared", "TRIP_ARRIVE_DISCOVER")).toBe(false);
    expect(betaOff("shared", "TRIP_THREE_MODES")).toBe(false);
    expect(betaOff("shared", "DOCUMENTED_TRIP_1")).toBe(true);
    expect(betaOff("rental", "RENTAL_FIRST")).toBe(false);
    const busOn = achievementVisibility(["flight", "bus"]);
    expect(busOn("shared", "TRIP_ARRIVE_DISCOVER")).toBe(true);
    expect(busOn("bus", "BUS_FIRST")).toBe(true);
  });
});
