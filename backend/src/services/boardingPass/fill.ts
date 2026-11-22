/**
 * The two late stages of reading a boarding pass: the flight-data lookup and
 * the language model. Both run only for what barcode and parser left open,
 * both fill gaps only (never overwrite what the pass itself said), and both
 * report their own outcome as a stage — a failure here is a reason the user
 * sees, not a silent "no times".
 */
import type { ParsedBooking } from "../bookingParser";
import type { ParserConfig } from "../parsers/types";
import { getTextParserInstance } from "../parsers/providers";
import logger from "../../utils/logger";
import { needsClock, openFields } from "./legs";
import type { BoardingPassStage } from "./stages";

type Legs = readonly ParsedBooking[];

function fillGaps(leg: ParsedBooking, from: Partial<ParsedBooking>): ParsedBooking {
  const filled: Partial<ParsedBooking> = {};
  for (const key of [
    "flightNumber",
    "departureCode",
    "arrivalCode",
    "arrivalTime",
    "seat",
    "gate",
    "terminal",
    "aircraft",
    "airline",
    "pnr",
  ] as const) {
    if (!leg[key] && from[key]) (filled as Record<string, unknown>)[key] = from[key];
  }
  if (needsClock(leg) && from.departureTime && !needsClock(from as ParsedBooking)) {
    const sameDay =
      !leg.departureTime || leg.departureTime.slice(0, 10) === from.departureTime.slice(0, 10);
    if (sameDay) filled.departureTime = from.departureTime;
  }
  return { ...leg, ...filled };
}

const changedFields = (before: ParsedBooking, after: ParsedBooking): string[] =>
  (
    ["departureTime", "arrivalTime", "flightNumber", "departureCode", "arrivalCode"] as const
  ).filter((k) => before[k] !== after[k]);

/**
 * Scheduled times from the flight-data providers, for legs that know flight
 * number and date but not the clock. A hit counts only when its route matches
 * the pass — the same check the route made before this moved here.
 */
export async function lookupStage(
  legs: Legs,
  userId: string
): Promise<{ legs: ParsedBooking[]; stage: BoardingPassStage }> {
  const wanting = legs.filter(
    (l) => l.flightNumber && l.departureTime && (needsClock(l) || !l.arrivalTime)
  );
  if (wanting.length === 0) {
    return {
      legs: [...legs],
      stage: { stage: "lookup", status: "skipped", code: "LOOKUP_NOT_NEEDED" },
    };
  }
  const { lookupFlightWithHistorical } = await import("../flightLookup");
  let failed = false;
  const filled: string[] = [];
  const out: ParsedBooking[] = [];
  for (const leg of legs) {
    if (!wanting.includes(leg)) {
      out.push(leg);
      continue;
    }
    try {
      const date = new Date(`${leg.departureTime!.slice(0, 10)}T12:00:00Z`);
      const { flights } = await lookupFlightWithHistorical(
        leg.flightNumber!,
        date,
        userId,
        leg.departureCode
      );
      const hit = flights.find(
        (f) => f.departure?.iata === leg.departureCode && f.arrival?.iata === leg.arrivalCode
      );
      if (!hit) {
        out.push(leg);
        continue;
      }
      const next = fillGaps(leg, {
        departureTime: hit.departure?.scheduledLocal,
        arrivalTime: hit.arrival?.scheduledLocal,
        aircraft: hit.aircraft,
        terminal: hit.departure?.terminal,
        gate: hit.departure?.gate,
        airline: hit.airline,
      });
      filled.push(...changedFields(leg, next));
      out.push(next);
    } catch (err) {
      failed = true;
      logger.warn({ err }, "[BoardingPassRead] flight lookup failed");
      out.push(leg);
    }
  }
  const fields = [...new Set(filled)];
  if (fields.length > 0) {
    return { legs: out, stage: { stage: "lookup", status: "ok", code: "LOOKUP_OK", fields } };
  }
  return {
    legs: out,
    stage: failed
      ? { stage: "lookup", status: "failed", code: "LOOKUP_FAILED" }
      : { stage: "lookup", status: "failed", code: "LOOKUP_NOT_FOUND" },
  };
}

/**
 * "UA952", "UA 0952" → carrier "UA", number "952"; "952" → number only. A
 * carrier designator is three letters or two characters with a letter in
 * them (U2, 4U), so a bare number is never split into a fake carrier.
 */
function flightIdentity(fn: string | undefined): { carrier?: string; number: string } | null {
  const m = (fn ?? "")
    .toUpperCase()
    .replace(/\s/g, "")
    .match(/^(?:([A-Z]{2,3}|[A-Z]\d|\d[A-Z]))?0*(\d{1,4}[A-Z]?)$/);
  return m ? { ...(m[1] ? { carrier: m[1] } : {}), number: m[2] } : null;
}

const conflicts = (a: string | undefined, b: string | undefined): boolean =>
  Boolean(a && b && a !== b);

/**
 * The model's answer belongs to a leg when the flight number agrees — the
 * carrier too whenever both name one (UA123 is not LH123) — and neither
 * airport contradicts the leg's.
 */
function sameFlight(leg: ParsedBooking, answer: ParsedBooking): boolean {
  const a = flightIdentity(leg.flightNumber);
  const b = flightIdentity(answer.flightNumber);
  if (!a || !b || a.number !== b.number || conflicts(a.carrier, b.carrier)) return false;
  return (
    !conflicts(leg.departureCode, answer.departureCode) &&
    !conflicts(leg.arrivalCode, answer.arrivalCode)
  );
}

/** A lone answer for a lone leg, when it names no flight that could contradict the leg. */
function loneUnnamedAnswer(
  legs: Legs,
  answers: readonly ParsedBooking[]
): ParsedBooking | undefined {
  if (legs.length !== 1 || answers.length !== 1) return undefined;
  const [leg] = legs;
  const [answer] = answers;
  if (flightIdentity(leg.flightNumber) && flightIdentity(answer.flightNumber)) return undefined;
  return conflicts(leg.departureCode, answer.departureCode) ||
    conflicts(leg.arrivalCode, answer.arrivalCode)
    ? undefined
    : answer;
}

/**
 * The language model over the OCR text — last, and only when a leg still
 * lacks an essential field. Matches its answer to a leg by flight number (or
 * takes the only answer for a single-leg pass); everything the barcode or the
 * printed card already said stays.
 */
export async function llmStage(
  legs: Legs,
  ocrText: string | undefined,
  config: ParserConfig,
  userId: string
): Promise<{ legs: ParsedBooking[]; stage: BoardingPassStage }> {
  const open = legs.length === 0 || legs.some((l) => openFields(l).length > 0);
  if (!open) {
    return { legs: [...legs], stage: { stage: "llm", status: "skipped", code: "LLM_NOT_NEEDED" } };
  }
  if (!ocrText || ocrText.trim() === "") {
    return { legs: [...legs], stage: { stage: "llm", status: "skipped", code: "LLM_NOT_NEEDED" } };
  }
  if (!config.textFallbacks?.includes("ollama")) {
    return {
      legs: [...legs],
      stage: { stage: "llm", status: "skipped", code: "LLM_NOT_CONFIGURED" },
    };
  }
  // A provider that cannot be built or probed is unreachable for this
  // request — never an exception that costs the legs already read.
  let parser: ReturnType<typeof getTextParserInstance>;
  try {
    parser = getTextParserInstance("ollama", config);
    const availability = await parser.checkAvailability();
    if (!availability.available) throw new Error(availability.reason ?? "unavailable");
  } catch (err) {
    logger.warn({ err }, "[BoardingPassRead] language model not reachable");
    return { legs: [...legs], stage: { stage: "llm", status: "failed", code: "LLM_UNREACHABLE" } };
  }
  let answers: ParsedBooking[];
  try {
    answers = await parser.parseEmail("Boarding pass (OCR)", ocrText, undefined, undefined, {
      userId,
      documentKind: "boardingPass",
    });
  } catch (err) {
    logger.warn({ err }, "[BoardingPassRead] language model failed on the boarding pass");
    return { legs: [...legs], stage: { stage: "llm", status: "failed", code: "LLM_FAILED" } };
  }
  if (answers.length === 0) {
    return { legs: [...legs], stage: { stage: "llm", status: "failed", code: "LLM_NOTHING" } };
  }
  if (legs.length === 0) {
    return {
      legs: answers,
      stage: { stage: "llm", status: "ok", code: "LLM_OK", count: answers.length },
    };
  }
  const filled: string[] = [];
  const out = legs.map((leg) => {
    const match = answers.find((a) => sameFlight(leg, a)) ?? loneUnnamedAnswer(legs, answers);
    if (!match) return leg;
    const next = fillGaps(leg, match);
    filled.push(...changedFields(leg, next));
    return next;
  });
  const fields = [...new Set(filled)];
  return {
    legs: out,
    stage:
      fields.length > 0
        ? { stage: "llm", status: "ok", code: "LLM_OK", fields }
        : { stage: "llm", status: "failed", code: "LLM_NOTHING" },
  };
}
