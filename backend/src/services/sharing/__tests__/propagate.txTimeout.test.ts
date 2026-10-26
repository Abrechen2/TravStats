import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * A write and its propagation share one transaction, and the copies of a big
 * trip take longer than Prisma's 5 s default (`SHARE_TX_TIMEOUT_MS`). A
 * `prisma.$transaction(async (tx) => …)` whose callback propagates must
 * therefore pass a `timeout` — the ferry and cruise-route writes did not, so a
 * member with many copies got a rolled-back save for a change that was fine.
 *
 * A source scanner, and it will age like its sibling `propagate.writePaths`:
 * it sees only the callback form written inline.
 *
 * A ratchet: FROZEN names the files that still had such a transaction when the
 * guard landed (2026-10-16), by count. A count may only fall, and must be
 * lowered when it does; a file not listed may have none.
 */
const SRC = join(__dirname, "../../..");
const PROPAGATES = /\b(propagateWrites?|propagateDeletes?|propagateBulk)\(/;
const CALL = /\.\$transaction\(\s*async\b/g;

const FROZEN: Record<string, number> = {
  "routes/bus.ts": 3,
  "routes/cruises.ts": 2,
  "routes/ferry/roadtrip.ts": 1,
  "routes/flights/remove.ts": 1,
  "routes/flights.ts": 1,
  "routes/flightsBatch.ts": 1,
  "routes/lodging/stays.ts": 1,
  "routes/lodging.ts": 1,
  "routes/rail.ts": 3,
  "routes/rental.ts": 1,
  "routes/trips/tourRoutes.ts": 1,
  "routes/trips/tripBookings.ts": 1,
  "routes/trips/tripStops.ts": 1,
  "services/bus/busRouteAgain.ts": 1,
  "services/cruise/createCruise.ts": 1,
  "services/flights/duplicateResolution.ts": 1,
  "services/importBatchService.ts": 2,
  "services/lodging/lodgingImportBatches.ts": 1,
  "services/rail/roadtripConversionWrite.ts": 1,
  "services/rental/rentalRowWrite.ts": 2,
  "services/tripCleanupService.ts": 1,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "generated" ? [] : sourceFiles(path);
    }
    return name.endsWith(".ts") && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** The text of the call starting at `open` (the index of its `(`), to its matching `)`. */
function callText(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/** file → how many inline propagating transactions in it pass no timeout. */
function offenders(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf-8");
    if (!PROPAGATES.test(source)) continue;
    for (const match of source.matchAll(CALL)) {
      const open = (match.index ?? 0) + match[0].indexOf("(");
      const call = callText(source, open);
      if (!PROPAGATES.test(call) || /\btimeout\s*:/.test(call)) continue;
      const name = relative(SRC, file).replace(/\\/g, "/");
      out[name] = (out[name] ?? 0) + 1;
    }
  }
  return out;
}

describe("propagating transactions carry the share timeout", () => {
  it("passes a timeout to every inline transaction that propagates, frozen files aside", () => {
    expect(offenders()).toEqual(FROZEN);
  });
});
