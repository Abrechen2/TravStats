import { describe, expect, it } from "vitest";
import { formatEvidenceDate } from "../evidenceText";

/**
 * An evidence row's date is the day the server's clock rule chose; the
 * reader's zone must not move it (ADR 0002). Read in the host zone, a
 * "2026-03-01" month drew as "Februar 2026" for a reader west of UTC — the
 * odd-zone CI job (America/St_Johns) is where that shows.
 */
describe("formatEvidenceDate — the day the server named", () => {
  it("keeps the month of a day at the start of the month", () => {
    expect(formatEvidenceDate({ value: "2026-03-01", precision: "month" }, "de")).toBe("März 2026");
  });

  it("keeps the year of 1 January", () => {
    expect(formatEvidenceDate({ value: "2026-01-01", precision: "year" }, "en")).toBe("2026");
  });

  it("prints a day as the day", () => {
    expect(formatEvidenceDate({ value: "2026-03-01", precision: "day" }, "de")).toBe("01.03.2026");
  });
});
