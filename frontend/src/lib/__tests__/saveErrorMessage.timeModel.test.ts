import { describe, expect, it } from "vitest";
import { saveErrorMessage } from "../saveErrorMessage";
import { MissingZoneError } from "../api/timeInput";
import { germanT } from "../../__tests__/helpers/germanT";

const refused = (status: number, code: string) => ({
  isAxiosError: true,
  response: { status, data: { error: "English prose written for a log", code } },
});

/**
 * The time model's refusals (ADR 0002, D3), as a German reader sees them —
 * resolved through the real German resources, so a key without copy fails.
 */
describe("saveErrorMessage — time codes in German", () => {
  const say = (err: unknown): string =>
    saveErrorMessage(err, germanT, "common:saveErrors.validation");

  it("LOCAL_TIME_NONEXISTENT names the clock change", () => {
    expect(say(refused(422, "LOCAL_TIME_NONEXISTENT"))).toBe(
      "Diese Uhrzeit gibt es an dem Tag dort nicht (Zeitumstellung). Bitte wähle eine Uhrzeit davor oder danach."
    );
  });

  it("TIME_SHAPE_REQUIRED asks the stale page to reload", () => {
    expect(say(refused(422, "TIME_SHAPE_REQUIRED"))).toMatch(/lade die Seite neu/);
  });

  it("ZONE_UNKNOWN says the server does not know the zone", () => {
    expect(say(refused(422, "ZONE_UNKNOWN"))).toMatch(/Zeitzone kennt der Server nicht/);
  });

  it("TZ_UNRESOLVED and the 503 stay apart", () => {
    expect(say(refused(422, "TZ_UNRESOLVED"))).toMatch(/keine Zeitzone bekannt/);
    expect(say(refused(503, "TIMEZONE_LOOKUP_UNAVAILABLE"))).toMatch(/gerade nicht bestimmen/);
  });

  it("a pick without a zone, refused before the request, reads as TZ_UNRESOLVED", () => {
    expect(say(new MissingZoneError("visitedAt"))).toMatch(/keine Zeitzone bekannt/);
  });

  it("never shows the server's English text", () => {
    for (const code of ["LOCAL_TIME_NONEXISTENT", "TIME_SHAPE_REQUIRED", "ZONE_UNKNOWN"]) {
      expect(say(refused(422, code))).not.toMatch(/English prose/);
    }
  });
});
