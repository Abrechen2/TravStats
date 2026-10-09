/**
 * The web's runner for `shared/flight/transferVectors.json` (forgejo#256). The
 * server runs the same file against its mirror
 * (`backend/src/shared/__tests__/flightTransferVectors.test.ts`), which counts
 * transfers for the statistics with it. Read from disk, not imported, so it
 * never enters the bundle.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SEPARATE_JOURNEY_AFTER_MINUTES,
  segmentTransfers,
  type FlightTransfer,
  type ResolvedTransferSegment,
} from "../flightTransfer";

interface VectorFile {
  separateJourneyAfterMinutes: number;
  cases: Array<{ id: string; segments: ResolvedTransferSegment[]; expect: FlightTransfer[] }>;
}

const vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../shared/flight/transferVectors.json"), "utf8")
) as VectorFile;

describe("flight transfer vectors (web)", () => {
  it("agrees on the stopover line", () => {
    expect(SEPARATE_JOURNEY_AFTER_MINUTES).toBe(vectors.separateJourneyAfterMinutes);
  });

  it.each(vectors.cases.map((c) => [c.id, c] as const))("%s", (_id, vector) => {
    expect(segmentTransfers(vector.segments)).toEqual(vector.expect);
  });
});
