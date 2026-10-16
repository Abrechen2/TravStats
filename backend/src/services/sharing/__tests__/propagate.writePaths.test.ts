import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

import { SHARE_ENTITIES, SHARE_TYPES } from "../shareTypes";

/**
 * Every WRITE to a shareable table propagates — or says why not, at the call
 * (spec 2026-10-16, D5). The file-level guard this replaces passed a file with
 * eight writes and one propagate call; it proved "this file mentions
 * propagation", not "this write propagates".
 *
 * A write is covered when
 *   (a) a propagation call follows it inside the same top-level declaration
 *       (from one column-0 declaration to the next), or
 *   (b) `// share-exempt: <reason>` stands on one of the two lines above it, or
 *   (c) its file is in FILE_EXEMPT — files whose every write shares one reason.
 * A `share-exempt` comment with no write in the two lines below it is stale and
 * fails, as is a FILE_EXEMPT entry that no longer writes or now propagates.
 *
 * This is a source scanner and it will age (memory: "Quelltext-scannende
 * Waechter altern"): `sharing.lowRatioPaths.test.ts` proves the paths it once
 * found weakest by running them.
 */
const SRC = join(__dirname, "../../..");
const TABLES = [
  ...SHARE_ENTITIES.map((e) => SHARE_TYPES[e].delegate),
  "lodging",
  "cruiseStop",
  "cruiseLeg",
];
const WRITE = new RegExp(
  `\\.(${TABLES.join("|")})\\s*\\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\\(`,
  "g"
);
const PROPAGATES = /\b(propagateWrites?|propagateDeletes?|detachTrip|propagateBulk)\(/;
const MARK = /\/\/ share-exempt: \S/;
const DECLARATION = /^(export |async |function |const |let |router\.|class )/;

// keyOps.ts and copyInto.ts write through generic delegates (`delegate.update`,
// `keyedDelegate(...)`), which WRITE does not match — listing them here would
// be a stale entry (preflight P7).
const FILE_EXEMPT: Record<string, string> = {
  "services/sharing/adapters/flat.ts": "propagation writes (the copies)",
  "services/sharing/adapters/bus.ts": "propagation writes (the copies)",
  "services/sharing/adapters/ferry.ts": "propagation writes (the copies)",
  "services/sharing/adapters/lodgingStay.ts": "propagation writes (the copies)",
  "services/sharing/adapters/cruise.ts": "propagation writes (the copies)",
  "services/sharing/adapters/stop.ts": "propagation writes (the copies)",
  "services/sharing/deriveCopy.ts": "a copy's derived status, written by propagation",
  "index.ts": "boot-time aircraft-name normalisation, applied to every account",
  "services/statusSweep.ts": "status sweep, runs over every account's rows",
  "services/flightAutoUpdate.ts": "provider tracking job, per account",
  "services/flightLandedStatus.ts": "provider tracking job, per account",
  "services/finalArrivalLookup.ts": "provider lookup job, per account",
  "services/bulkFlightRefresh.ts": "provider refresh, per account",
  "services/nextApiCheckBackfill.ts": "scheduling column — private",
  "services/lodging/geocodeBackfill.ts": "geocoding job, per account",
  "services/lodging/stayFxBackfill.ts": "FX snapshot — private",
  "services/openData/lodgingEnrichment.ts": "open-data enrichment job, per account",
  "services/timeMigration/flights.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/cruises.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/rail.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/tripStops.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/dayColumns.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/reResolve.ts": "ADR 0002 migration, every account alike",
  "services/xlsxImport/flights.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/rail.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/bus.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/ferry.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/cruises.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/lodging.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/prune.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/routeLists.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/companionLinks.ts": "companions — private",
  "services/tour/replaceTourPoints.ts": "tour points — not shared",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ["generated", "__tests__", "scripts", "seedDemo"].includes(name) ? [] : sources(path);
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.startsWith("seed")) return [];
    return [path];
  });
}

interface Write {
  rel: string;
  line: number;
}

function uncovered(rel: string, text: string): Write[] {
  const lines = text.split("\n");
  const starts = lines.flatMap((l, i) => (DECLARATION.test(l) ? [i] : []));
  const blockEnd = (line: number) => starts.find((s) => s > line) ?? lines.length;
  const out: Write[] = [];
  for (const match of text.matchAll(WRITE)) {
    const line = text.slice(0, match.index).split("\n").length - 1;
    const marked = [line - 1, line - 2].some((i) => i >= 0 && MARK.test(lines[i]));
    const after = lines.slice(line, blockEnd(line)).join("\n");
    if (!marked && !PROPAGATES.test(after.slice(after.indexOf(match[0]) + match[0].length))) {
      out.push({ rel, line: line + 1 });
    }
  }
  return out;
}

function staleMarks(rel: string, text: string): Write[] {
  const lines = text.split("\n");
  return lines.flatMap((l, i) => {
    if (!MARK.test(l)) return [];
    const below = lines.slice(i + 1, i + 3).join("\n");
    return new RegExp(WRITE.source).test(below) ? [] : [{ rel, line: i + 1 }];
  });
}

describe("sharing — every write to a shareable table propagates, per call", () => {
  const files = sources(SRC).map((path) => ({
    rel: relative(SRC, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  }));
  const writes = (text: string) => new RegExp(WRITE.source).test(text);

  it("finds the writers at all", () => {
    expect(files.filter((f) => writes(f.text)).length).toBeGreaterThan(30);
  });

  it("each write propagates or carries its reason", () => {
    const missing = files
      .filter((f) => !(f.rel in FILE_EXEMPT))
      .flatMap((f) => uncovered(f.rel, f.text))
      .map((w) => `${w.rel}:${w.line}`);
    expect(missing).toEqual([]);
  });

  it("no share-exempt comment is stale", () => {
    const stale = files.flatMap((f) => staleMarks(f.rel, f.text)).map((w) => `${w.rel}:${w.line}`);
    expect(stale).toEqual([]);
  });

  it("no file exemption is stale", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.text]));
    const stale = Object.keys(FILE_EXEMPT).filter((rel) => {
      const text = byRel.get(rel);
      return !text || !writes(text) || PROPAGATES.test(text);
    });
    expect(stale).toEqual([]);
  });
});
