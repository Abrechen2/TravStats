import { describe, it, expect } from "vitest";
import { estimateFlightTimes } from "../lib/timeEstimation";

/**
 * The suggested departure (boarding + 30 min) is wall-clock arithmetic at the
 * airport — the HOST zone must not take part (ADR 0002, D6). The old code
 * built the clock as a host-local Date, so on the night the reader's OWN
 * clocks sprang forward a 01:40 boarding in Berlin suggested 03:10 instead of
 * 02:10. The CI odd-zone jobs and this test's own run in Europe/Berlin
 * (`TZ=Europe/Berlin npx vitest …`) are what can see it.
 */
describe("estimateFlightTimes — host zone does not move the clock", () => {
  it("adds 30 minutes to a boarding time across the host's spring-forward night", () => {
    const result = estimateFlightTimes("01:40", "2026-03-29", undefined, "XXA", "XXB", 0, 0, 0, 0);
    expect(result.departureTime).toBe("02:10");
  });
});
