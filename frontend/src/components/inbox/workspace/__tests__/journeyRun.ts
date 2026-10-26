import type { JourneyRun } from "../../../../lib/api/locationSuggestions";

/** One run of a journey question, as the server lists it. Not a test file. */
export const run: JourneyRun = {
  index: 0,
  fromMs: Date.parse("2026-10-20T04:32:00Z"),
  untilMs: Date.parse("2026-10-20T06:02:00Z"),
  km: 150.2,
  start: { lat: 50.1, lon: 8.66 },
  end: { lat: 49.79, lon: 9.95 },
  startRecorded: true,
  endRecorded: false,
  startZone: "Europe/Berlin",
  endZone: "Europe/London",
  modeHint: "rail",
  state: "open",
  link: null,
};
