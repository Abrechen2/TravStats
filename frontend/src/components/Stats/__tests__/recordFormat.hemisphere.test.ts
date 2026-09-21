import { describe, expect, it } from "vitest";
import { formatRecordValue } from "../recordFormat";
import type { TravelRecord } from "../../../types/travelRecords";

/**
 * SRV-STATS-HEMISPHERE-001 (audit 2026-09-20). `degrees-north` is the AXIS —
 * north-positive — not a claim that the point lies north of the equator. The
 * formatter printed the signed number beside the word "Nord", so a southern
 * airport read "-33,9° Nord".
 */
const ctx = {
  distanceUnit: "kilometers" as const,
  language: "en",
  // The real `t` would return "north"/"south"; the key itself is the more
  // useful assertion — it proves WHICH word was chosen.
  t: (key: string) => key,
};

function record(value: number): TravelRecord {
  return { id: "northernmost", value, unit: "degrees-north" } as TravelRecord;
}

describe("formatRecordValue — degrees-north", () => {
  it("says south, with an unsigned figure, for a negative latitude", () => {
    expect(formatRecordValue(record(-33.95), ctx)).toBe("34° stats:records.units.south");
  });

  it("still says north for a positive one", () => {
    expect(formatRecordValue(record(69.9726), ctx)).toBe("70° stats:records.units.north");
  });

  it("puts the equator on the north side rather than inventing a third word", () => {
    expect(formatRecordValue(record(0), ctx)).toBe("0° stats:records.units.north");
  });
});
