/**
 * Small readers every tracker parser needs (forgejo#311). Each one answers
 * `undefined` for a value it cannot read rather than a guess — the caller
 * decides whether that costs the row or only the field.
 */
import { isLocalDate } from "../../../shared/time/localDate";
import { resolveAirlineCodes } from "../../../utils/airlineNormalize";
import type { ParserError, ParserErrorCode } from "../csvImportTypes";

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/;
const AIRPORT_CODE_RE = /^[A-Z0-9]{3,4}$/;

/** Values the exports write for "nothing here". */
const ABSENT = new Set(["", "\\N", "N/A", "None", "null"]);

/** The trimmed cell, or undefined when the export left it empty. */
export function present(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return ABSENT.has(trimmed) ? undefined : trimmed;
}

/** `H:MM`, `HH:MM` or `HH:MM:SS` as `HH:MM:SS`; undefined for anything else. */
export function normalizeTime(value: string): string | undefined {
  const m = TIME_RE.exec(value.trim());
  if (!m) return undefined;
  const [hh, mm, ss] = [Number(m[1]), Number(m[2]), Number(m[3] ?? "0")];
  if (hh > 23 || mm > 59 || ss > 59) return undefined;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

/** A wall-clock reading `YYYY-MM-DDTHH:MM[:SS]` split into a real day and a time. */
export function splitLocalDateTime(value: string): { date: string; time: string } | undefined {
  const m = LOCAL_DATETIME_RE.exec(value.trim());
  if (!m || !isLocalDate(m[1])) return undefined;
  const time = normalizeTime(m[2]);
  return time ? { date: m[1], time } : undefined;
}

export function isRealDate(value: string): boolean {
  return isLocalDate(value);
}

/** An airport code in a shape the airport lookup can answer, upper-cased. */
export function airportCode(value: string | undefined): string | undefined {
  const upper = (value ?? "").trim().toUpperCase();
  return AIRPORT_CODE_RE.test(upper) ? upper : undefined;
}

export interface AirlineReading {
  /** The airline's name when the catalogue knows the code, the code itself otherwise. */
  name: string;
  /** The designator to prefix a bare flight number with — IATA when known. */
  designator: string;
}

/**
 * An airline the export names only by code. An unknown code is NOT a reason
 * to drop the flight (owner rule, 2026-10-01): it is kept as written, and the
 * flight still imports.
 */
export function airlineFromCode(code: string | undefined): AirlineReading | undefined {
  const raw = (code ?? "").trim().toUpperCase();
  if (!raw) return undefined;
  const hit = resolveAirlineCodes(raw);
  return hit ? { name: hit.name, designator: hit.iata } : { name: raw, designator: raw };
}

/** "UA" + "1234" → "UA1234"; a number that already carries letters is left alone. */
export function joinFlightNumber(
  designator: string | undefined,
  number: string | undefined
): string | undefined {
  const n = (number ?? "").trim();
  if (!n) return undefined;
  if (/^\d+[A-Z]?$/i.test(n) && designator) return `${designator}${n}`;
  return n;
}

export function rowError(
  rowIndex: number,
  code: ParserErrorCode,
  message: string,
  extra: Partial<ParserError> = {}
): ParserError {
  return { rowIndex, code, message, ...extra };
}

export function missingHeaders(headers: string[], required: readonly string[]): ParserError[] {
  return required
    .filter((h) => !headers.includes(h))
    .map((h) => ({
      rowIndex: -1,
      code: "missingHeader" as const,
      value: h,
      message: `Missing required header column: ${h}`,
    }));
}
