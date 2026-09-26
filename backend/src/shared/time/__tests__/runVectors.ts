import { AppError } from "../../../middleware/errorHandler";
import { setClockForTests, todayIn } from "../clock";
import { localDay, toInstant, toLocal } from "../instant";
import { daysBetween, fromDbDate, toDbDate } from "../localDate";
import type { VectorCase, VectorFile } from "./vectorFile";

/**
 * The server's runner for `shared/time/vectors.json`. Kept free of Jest so the
 * odd-zone test can run it in a CHILD process: `process.env.TZ` changed inside
 * a running Jest worker does not move the zone the runtime already read.
 */

/** The ops the server implements; `display` is a client concern. */
const SERVER_OPS = new Set<VectorCase["op"]>([
  "toInstant",
  "toLocal",
  "localDay",
  "todayIn",
  "span",
  "floatingDate",
]);

export function appliesToServer(c: VectorCase): boolean {
  return SERVER_OPS.has(c.op) && (c.appliesTo === undefined || c.appliesTo.includes("server"));
}

export interface VectorResult {
  id: string;
  ok: boolean;
  actual: unknown;
  expected: unknown;
}

const iso = (d: Date): string => d.toISOString();

/** Instants are compared as instants, everything else exactly (schema rule 2). */
function sameInstant(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && Date.parse(a) === Date.parse(b);
}

const INSTANT_KEYS = new Set(["utc", "startUtc", "endUtc"]);

function matches(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of keys) {
    const ok = INSTANT_KEYS.has(key)
      ? sameInstant(actual[key], expected[key])
      : actual[key] === expected[key];
    if (!ok) return false;
  }
  return true;
}

function evaluate(c: VectorCase): Record<string, unknown> {
  switch (c.op) {
    case "toInstant": {
      const { local, zone, origin, fold } = c.input;
      const r = toInstant(local, zone, { origin, fold });
      return { utc: iso(r.utc), offset: r.offset, ambiguous: r.ambiguous };
    }
    case "toLocal":
      return { ...toLocal(c.input.utc, c.input.zone) };
    case "localDay":
      return { day: localDay(c.input.utc, c.input.zone) };
    case "todayIn": {
      setClockForTests(c.input.now);
      try {
        return { day: todayIn(c.input.zone) };
      } finally {
        setClockForTests(null);
      }
    }
    case "span": {
      const start = toInstant(c.input.start.local, c.input.start.zone);
      const end = toInstant(c.input.end.local, c.input.end.zone);
      const startDay = localDay(start.utc, c.input.start.zone);
      const endDay = localDay(end.utc, c.input.end.zone);
      return {
        startUtc: iso(start.utc),
        endUtc: iso(end.utc),
        minutes: Math.round((end.utc.getTime() - start.utc.getTime()) / 60_000),
        startDay,
        endDay,
        dayDiff: daysBetween(startDay, endDay),
      };
    }
    case "floatingDate":
      return { date: fromDbDate(toDbDate(c.input.date)) };
    case "display":
      throw new Error("display is a client op");
  }
}

export function runCase(c: VectorCase): VectorResult {
  let actual: Record<string, unknown>;
  try {
    actual = evaluate(c);
  } catch (error) {
    actual =
      error instanceof AppError && error.code
        ? { error: error.code }
        : { thrown: error instanceof Error ? error.message : String(error) };
  }
  return {
    id: c.id,
    ok: matches(actual, c.expect as Record<string, unknown>),
    actual,
    expected: c.expect,
  };
}

export function runServerVectors(file: VectorFile): VectorResult[] {
  return file.cases.filter(appliesToServer).map(runCase);
}
