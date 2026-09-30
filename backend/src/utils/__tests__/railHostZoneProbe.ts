/**
 * Child-process half of `railAchievements.hostZone.test.ts`.
 *
 * Jest cannot move the host zone: assigning `process.env.TZ` inside a test file
 * does not reach V8's date cache there (measured 2026-09-26 — `getDate()` kept
 * answering in the machine's zone), so a suite that "runs under" another zone
 * that way proves nothing. A real Node process honours the assignment, so the
 * test runs this file in one and reads its answers.
 */
import { railRideFacts, type RailBadgeRow } from "../railAchievements";
import { railEnds } from "../../services/stats/railEvidence";
import { railYear } from "../../shared/railCounting";

process.env.TZ = process.argv[2] ?? "UTC";

const base: RailBadgeRow = {
  id: "r",
  operator: null,
  trainCategory: null,
  trainNumber: null,
  travelClass: null,
  depStationName: "Wien Hbf",
  arrStationName: "Hamburg Hbf",
  depCountry: "AT",
  arrCountry: "DE",
  depTimezone: "Europe/Vienna",
  arrTimezone: "Europe/Berlin",
  // 22:00 in Vienna on 1 March → 09:00 in Hamburg on 2 March.
  departureTime: new Date("2025-03-01T21:00:00Z"),
  arrivalTime: new Date("2025-03-02T08:00:00Z"),
  distanceKm: null,
};
// 22:30 in Vienna on New Year's Eve.
const eve = { ...base, departureTime: new Date("2025-12-31T21:30:00Z"), arrivalTime: null };

process.stdout.write(
  JSON.stringify({
    hostDayOfDeparture: base.departureTime.getDate(),
    isNightTrain: railRideFacts(base).isNightTrain,
    eveYear: railYear(eve),
    eveDays: railEnds([{ ...eve, label: "NJ" }]).find((e) => e.country === "AT")?.days,
  })
);
