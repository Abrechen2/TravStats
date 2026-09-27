/**
 * The web's runner for the shared time vectors (ADR 0002, D5).
 *
 * `shared/time/vectors.json` at the repository root is the contract the
 * server, the web and the Companion are each held to. It is read from disk
 * here, not imported, so it never enters the bundle.
 *
 * Which cases run follows the file's own rule 1: a case runs when its
 * `appliesTo` (default: all) names the web AND the web implements its op. The
 * web mirror is display-only, so `toInstant`, `span` and `floatingDate` are
 * the server's — and a case with an op this runner has never heard of fails
 * instead of being skipped, so a new op cannot slip past unrun.
 *
 * Every case runs three times, with the process zone switched to UTC,
 * Pacific/Kiritimati (UTC+14) and America/St_Johns (UTC−3:30); each block
 * first proves the switch took. The CI odd-zone jobs run this file again with
 * `TZ` set from the outside.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { displayParts, localDay, setClockForTests, toLocal, todayIn, type TimeValue } from "..";

interface VectorCase {
  id: string;
  op: string;
  appliesTo?: string[];
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
}

interface VectorFile {
  version: number;
  minTzdata: string;
  cases: VectorCase[];
}

const VECTORS_PATH = resolve(__dirname, "../../../../../shared/time/vectors.json");
const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as VectorFile;

const WEB_OPS = new Set(["toLocal", "localDay", "todayIn", "display"]);
const SERVER_ONLY_OPS = new Set(["toInstant", "span", "floatingDate"]);

const forWeb = (c: VectorCase): boolean => c.appliesTo === undefined || c.appliesTo.includes("web");
const webCases = vectors.cases.filter((c) => forWeb(c) && WEB_OPS.has(c.op));

function evaluate(c: VectorCase): Record<string, unknown> {
  const input = c.input as Record<string, string> & { value: TimeValue };
  switch (c.op) {
    case "toLocal": {
      const r = toLocal(input.utc, input.zone);
      return { local: r.local, offset: r.offset };
    }
    case "localDay":
      return { day: localDay(input.utc, input.zone) };
    case "todayIn":
      setClockForTests(input.now);
      return { day: todayIn(input.zone) };
    case "display": {
      const parts = displayParts(input.value);
      return parts ? { ...parts } : { error: "VALIDATION_FAILED" };
    }
    default:
      throw new Error(`No web implementation for op ${c.op} (${c.id})`);
  }
}

/** An expected `{ error }` must be exactly that stable code (rule 3). */
function run(c: VectorCase): Record<string, unknown> {
  try {
    return evaluate(c);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return { error: code };
    throw err;
  }
}

describe("the vector file", () => {
  it("is one this runner understands, on tzdata at least as new as it needs", () => {
    expect(vectors.version).toBe(2);
    const tz = process.versions.tz;
    expect(tz, "Node reports no tzdata version").toBeTruthy();
    expect((tz as string) >= vectors.minTzdata).toBe(true);
  });

  it("names no op the web neither runs nor knows to leave to the server", () => {
    const unknown = vectors.cases
      .filter((c) => forWeb(c) && !WEB_OPS.has(c.op) && !SERVER_ONLY_OPS.has(c.op))
      .map((c) => `${c.id} (${c.op})`);
    expect(unknown).toEqual([]);
  });

  it("gives the web cases of every op it implements", () => {
    const ops = new Set(webCases.map((c) => c.op));
    expect([...ops].sort()).toEqual([...WEB_OPS].sort());
  });
});

const HOST_ZONES: Array<[string, number]> = [
  ["UTC", 0],
  ["Pacific/Kiritimati", -840],
  ["America/St_Johns", 210],
];

const originalTz = process.env.TZ;

describe.each(HOST_ZONES)("web vectors with the host in %s", (hostZone, hostOffset) => {
  beforeAll(() => {
    process.env.TZ = hostZone;
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });
  afterEach(() => setClockForTests(null));

  it("really runs in that host zone (control)", () => {
    expect(new Date(Date.UTC(2027, 0, 1)).getTimezoneOffset()).toBe(hostOffset);
  });

  it.each(webCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(run(c)).toEqual(c.expect);
  });
});
