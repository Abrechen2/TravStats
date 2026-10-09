import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SEPARATE_JOURNEY_AFTER_MINUTES,
  segmentTransfers,
  type FlightTransfer,
  type ResolvedTransferSegment,
} from "../flightTransfer";

/**
 * The server's runner for `shared/flight/transferVectors.json` (forgejo#256).
 * The web runs the same file against its mirror
 * (`frontend/src/shared/__tests__/flightTransferVectors.test.ts`), so the wait
 * a booking page shows and the wait the transfer statistics count are one rule.
 */
interface VectorFile {
  separateJourneyAfterMinutes: number;
  cases: Array<{ id: string; segments: ResolvedTransferSegment[]; expect: FlightTransfer[] }>;
}

const VECTORS_PATH = path.resolve(__dirname, "../../../../shared/flight/transferVectors.json");
const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as VectorFile;

describe("flight transfer vectors (server)", () => {
  it("agrees on the stopover line", () => {
    expect(SEPARATE_JOURNEY_AFTER_MINUTES).toBe(vectors.separateJourneyAfterMinutes);
  });

  it.each(vectors.cases.map((c) => [c.id, c] as const))("%s", (_id, vector) => {
    expect(segmentTransfers(vector.segments)).toEqual(vector.expect);
  });
});
