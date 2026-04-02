import type { ParsedBooking } from "../../bookingParser";
import type { FieldSources, TemplatePatterns, UserTemplate } from "./types";

// Reiseplan structural segment regex (validated in proof-of-concept against 5 Lufthansa emails)
// Matches: dep_datetime ... arr_datetime ... FlightNumber Durchgeführt
const RE_REISEPLAN_SEG = new RegExp(
  "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s+-\\s+(\\d{2}:\\d{2})" +
    "[\\s\\S]{1,800}?" +
    "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s+-\\s+(\\d{2}:\\d{2})" +
    "[\\s\\S]{1,400}?" +
    "([A-Z]{2,3}\\s?\\d{1,4})\\s+Durchgef",
  "g"
);

// Buchungsdetails block: IATA_dep <img_url> IATA_arr \n dep_time \n arr_time
const RE_DETAILS_BLOCK_DEFAULT = new RegExp(
  "([A-Z]{3})\\s+<https?://[^>]+>\\s+([A-Z]{3})" +
    "[\\s\\S]{1,300}?" +
    "(\\d{2}:\\d{2})\\s*\\n\\s*(\\d{2}:\\d{2})",
  "g"
);

function applyPattern(pattern: string, body: string): string | undefined {
  try {
    const re = new RegExp(pattern, "s");
    const m = re.exec(body);
    return m?.[1]?.trim() ?? undefined;
  } catch {
    return undefined;
  }
}

function extractReiseplanFlights(
  body: string,
  pnr: string | undefined,
  detailsBlockPattern?: string
): Array<Partial<ParsedBooking> & { fieldSources: FieldSources }> {
  const reiseplanIdx = body.indexOf("Reiseplan");
  const searchText = reiseplanIdx >= 0 ? body.slice(reiseplanIdx) : body;

  RE_REISEPLAN_SEG.lastIndex = 0;
  const flights: Array<Partial<ParsedBooking> & { fieldSources: FieldSources }> = [];

  for (const m of searchText.matchAll(RE_REISEPLAN_SEG)) {
    const depD = m[1] as string;
    const depMo = m[2] as string;
    const depY = m[3] as string;
    const depT = m[4] as string;
    const arrD = m[5] as string;
    const arrMo = m[6] as string;
    const arrY = m[7] as string;
    const arrT = m[8] as string;
    const fn = (m[9] as string).replace(/\s/, "");

    const fieldSources: FieldSources = {
      flightNumber: "template",
      departureTime: "template",
      arrivalTime: "template",
    };
    if (pnr) {
      fieldSources.pnr = "template";
    }

    flights.push({
      flightNumber: fn,
      departureTime: `${depY}-${depMo}-${depD}T${depT}:00`,
      arrivalTime: `${arrY}-${arrMo}-${arrD}T${arrT}:00`,
      departureCode: undefined,
      arrivalCode: undefined,
      pnr,
      fieldSources,
      missing: [],
    });
  }

  // Enrich IATA codes from Buchungsdetails block
  let detailsRe: RegExp;
  if (detailsBlockPattern) {
    try {
      detailsRe = new RegExp(detailsBlockPattern, "g");
    } catch {
      detailsRe = new RegExp(RE_DETAILS_BLOCK_DEFAULT.source, "g");
    }
  } else {
    detailsRe = new RegExp(RE_DETAILS_BLOCK_DEFAULT.source, "g");
  }
  detailsRe.lastIndex = 0;

  for (const m of body.matchAll(detailsRe)) {
    const depIata = m[1] as string;
    const arrIata = m[2] as string;
    const depTimeHHMM = m[3] as string;
    for (const f of flights) {
      if (f.departureCode === undefined && f.departureTime?.includes("T" + depTimeHHMM)) {
        f.departureCode = depIata;
        f.arrivalCode = arrIata;
        f.fieldSources.departureCode = "template";
        f.fieldSources.arrivalCode = "template";
        break;
      }
    }
  }

  return flights;
}

function computeConfidence(booking: Partial<ParsedBooking>): number {
  const CRITICAL = ["flightNumber", "departureCode", "arrivalCode", "departureTime", "pnr"];
  const filled = CRITICAL.filter(
    (k) => (booking as Record<string, unknown>)[k] != null
  ).length;
  return Math.round((filled / CRITICAL.length) * 100);
}

/**
 * Applies a UserTemplate to a plain-text email body.
 * Returns an array of ParsedBooking (one per detected flight),
 * each with a `fieldSources` map for confidence colour-coding.
 */
export function applyUserTemplate(
  template: UserTemplate,
  _subject: string,
  body: string
): Array<ParsedBooking & { fieldSources: FieldSources }> {
  const patterns: TemplatePatterns = template.patterns;

  // Extract PNR (shared across all flights in the booking)
  const pnr = patterns.pnr ? applyPattern(patterns.pnr, body) : undefined;
  const pnrSource: FieldSources = pnr ? { pnr: "template" } : {};

  // Multi-flight via structural Reiseplan parser
  if (patterns.useReiseplanSegments) {
    const flights = extractReiseplanFlights(body, pnr, patterns.detailsBlock);
    if (flights.length > 0) {
      return flights.map((f) => ({
        missing: [],
        parserTemplate: template.name,
        parserConfidence: computeConfidence(f),
        ...f,
        fieldSources: { ...pnrSource, ...f.fieldSources } as FieldSources,
      })) as Array<ParsedBooking & { fieldSources: FieldSources }>;
    }
  }

  // Single-flight: apply per-field patterns
  const fieldSources: FieldSources = { ...pnrSource };
  const booking: ParsedBooking = { missing: [], pnr };

  // TemplatePatterns key → ParsedBooking key (aircraftType → aircraft)
  const FIELD_MAP: Array<[keyof TemplatePatterns, keyof ParsedBooking]> = [
    ["flightNumber", "flightNumber"],
    ["departureCode", "departureCode"],
    ["arrivalCode", "arrivalCode"],
    ["aircraftType", "aircraft"],
  ];

  for (const [patKey, bookKey] of FIELD_MAP) {
    const pat = patterns[patKey];
    if (typeof pat === "string") {
      const val = applyPattern(pat, body);
      if (val) {
        (booking as unknown as Record<string, unknown>)[bookKey] = val;
        (fieldSources as Record<string, string>)[bookKey as string] = "template";
      }
    }
  }

  booking.parserTemplate = template.name;
  booking.parserConfidence = computeConfidence(booking);

  return [{ ...booking, fieldSources }];
}
