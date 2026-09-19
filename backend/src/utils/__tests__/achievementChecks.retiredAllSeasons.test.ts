/**
 * `case "all_seasons"` in `achievementChecks.ts` must stay, and this test is why
 * it can be found.
 *
 * FOUR_SEASONS_YEAR was retired from the seed catalogue, so nothing in
 * `data/achievements.ts` asks for `all_seasons` any more and the case reads like
 * dead code. It is not. `ensureAchievements` never deletes, so the row and
 * everyone who earned it are still in every existing database — the
 * 2026-09-19 integrity audit listed it as the one such badge on the prod
 * mirror, and `routes/achievements.ts` has a whole `isRetired` branch built
 * around keeping those visible.
 *
 * Delete the case and `checkAchievement` falls through to the default: progress
 * 0. The boot-time re-check would then write that 0 over a real measurement.
 * Since this round that no longer costs the badge itself (`unlockedAt`
 * survives — see `achievementHeld.ts`), but it still empties the progress bar
 * behind one somebody genuinely earned.
 *
 * "Nothing references it" is true of the catalogue and false of the database.
 */

import { checkAchievement } from "../achievementChecks";
import type { Achievement } from "../../prisma";
import type { FlightData, UserStats } from "../achievementStats";

const FOUR_SEASONS_YEAR: Achievement = {
  id: "ach-four-seasons-year",
  code: "FOUR_SEASONS_YEAR",
  name: "Four seasons",
  description: "Fly in all four seasons of one year",
  category: "special",
  domain: "flight",
  icon: "calendar",
  tier: "gold",
  requirement: 4,
  requirementType: "all_seasons",
  points: 50,
  isHidden: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

/** One flight per season of 2024, which is what the retired badge measured. */
const FLIGHTS: FlightData[] = [
  "2024-01-15T09:00:00Z", // winter
  "2024-04-15T09:00:00Z", // spring
  "2024-07-15T09:00:00Z", // summer
  "2024-10-15T09:00:00Z", // autumn
].map((iso, index) => ({
  id: `season-${index}`,
  depLat: 50.0379,
  depLon: 8.5622,
  arrLat: 48.3538,
  arrLon: 11.7861,
  depIcao: null,
  depIata: "FRA",
  arrIcao: null,
  arrIata: "MUC",
  airline: "Lufthansa",
  aircraft: null,
  flightNumber: null,
  seatNumber: null,
  seatClass: null,
  notes: null,
  actualDeparture: null,
  delayMinutes: null,
  departureTime: new Date(iso),
  arrivalTime: new Date(iso),
  depTimeSemantics: "UTC",
  status: "flown",
  specialType: null,
}));

const EMPTY_STATS = {} as unknown as UserStats;

describe("checkAchievement — the retired all_seasons case", () => {
  it("still measures a legacy FOUR_SEASONS_YEAR row instead of answering 0", () => {
    const { progress, isUnlocked } = checkAchievement(FOUR_SEASONS_YEAR, EMPTY_STATS, FLIGHTS);

    // Removing the case makes both of these fail: the default returns progress 0.
    expect(progress).toBe(4);
    expect(isUnlocked).toBe(true);
  });

  it("still measures a partial year, so the progress bar keeps its number", () => {
    const { progress, isUnlocked } = checkAchievement(
      FOUR_SEASONS_YEAR,
      EMPTY_STATS,
      FLIGHTS.slice(0, 2)
    );

    expect(progress).toBe(2);
    expect(isUnlocked).toBe(false);
  });
});
