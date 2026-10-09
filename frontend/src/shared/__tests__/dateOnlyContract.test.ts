/**
 * forgejo#273 — the web mirror of `backend/src/__tests__/dateOnlyContract.test.ts`,
 * reading the same cases (`shared/time/dateOnlyFlights.json`); change both
 * together. The backend suite proves each `stored` value is what the server
 * writer makes of `local` + `zone`; this one proves the form writes that
 * `local`, and that the web's `localWallClockOf` reads the stored instant
 * back on the recorded day — the overview tab's year, month and day.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { localWallClockOf } from "../localWallClock";
import { buildLocalString } from "../../components/FlightForm/flightFormModel";

interface DateOnlyCase {
  id: string;
  writer: "form" | "cruiseImport";
  zone: string;
  day: string;
  local: string;
  stored: string;
}

const VECTOR_PATH = resolve(__dirname, "../../../../shared/time/dateOnlyFlights.json");
const CASES = (JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as { cases: DateOnlyCase[] }).cases;

describe.each(CASES)("DATE_ONLY $id ($writer, $zone) stays on $day", (c) => {
  if (c.writer === "form") {
    it("is the wall clock the historical form writes for that day", () => {
      expect(buildLocalString(c.day, "", { anchorDateOnly: true })).toBe(c.local);
    });
  }

  it("reads back on the recorded day in the web mirror, with no hour", () => {
    const clock = localWallClockOf(new Date(c.stored), c.zone, "DATE_ONLY");
    expect(clock.date).toBe(c.day);
    expect(clock.year).toBe(Number(c.day.slice(0, 4)));
    expect(clock.hour).toBeNull();
  });
});
