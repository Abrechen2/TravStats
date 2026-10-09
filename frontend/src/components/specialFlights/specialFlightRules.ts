import type { Airport } from "../../lib/api";
import type { MissingStep } from "../form";
import {
  SPECIAL_IDS,
  type SpecialFieldErrors,
  type SpecialKind,
} from "../SpecialFlightModalFields";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const isValidLat = (n: number): boolean => Number.isFinite(n) && n >= -90 && n <= 90;
const isValidLon = (n: number): boolean => Number.isFinite(n) && n >= -180 && n <= 180;

export interface SpecialFlightDraftRules {
  kind: SpecialKind | null;
  departureAirport: Airport | null;
  eventLat: string;
  eventLon: string;
  patternLat: string;
  patternLon: string;
}

/**
 * The special-flight form's client rules, per field (forgejo#246): the one
 * required airport, and coordinates inside their range. The same rules the
 * builders refused with a single banner before — now said at the field.
 */
export function specialFlightFieldErrors(
  draft: SpecialFlightDraftRules,
  t: Translate
): SpecialFieldErrors {
  const errors: SpecialFieldErrors = {};
  if (draft.kind === null) return errors;
  if (!draft.departureAirport) errors.departureAirport = t("specialFlights:error.missingAirport");
  const coordinate = (value: string, valid: (n: number) => boolean): string | null =>
    value !== "" && !valid(Number(value)) ? t("specialFlights:error.invalidCoordinates") : null;
  if (draft.kind === "event") {
    errors.eventLat = coordinate(draft.eventLat, isValidLat);
    errors.eventLon = coordinate(draft.eventLon, isValidLon);
  }
  if (draft.kind === "zerog") {
    errors.patternLat = coordinate(draft.patternLat, isValidLat);
    errors.patternLon = coordinate(draft.patternLon, isValidLon);
  }
  return errors;
}

/** The same rules as the "Zum Speichern fehlt noch" line, in form order. */
export function specialFlightGaps(errors: SpecialFieldErrors, t: Translate): MissingStep[] {
  const gaps: MissingStep[] = [];
  if (errors.departureAirport) {
    gaps.push({ field: SPECIAL_IDS.departureAirport, label: t("specialFlights:missing.airport") });
  }
  for (const key of ["eventLat", "eventLon", "patternLat", "patternLon"] as const) {
    if (errors[key]) {
      gaps.push({ field: SPECIAL_IDS[key], label: t("specialFlights:missing.coordinates") });
      break;
    }
  }
  return gaps;
}

/** The server's `field` for a time refusal → the special form's input. */
export const SPECIAL_SERVER_FIELDS: Readonly<Record<string, keyof SpecialFieldErrors>> = {
  departureLocal: "departureTime",
  arrivalLocal: "arrivalTime",
};
