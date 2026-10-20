/**
 * One entry point for "a file from another flight tracker" (forgejo#311):
 * recognise the format from the file itself, then read it.
 *
 * A file nothing recognises is an error that names what was looked for —
 * never an empty, successful read. Zero rows from an unknown file looked
 * exactly like an export with no flights in it.
 */
import { parseCsvHeader } from "../csvParser";
import type { ParseResult } from "../csvImportTypes";
import { parseFr24 } from "../fr24";
import { parseAirTrail, airTrailFileSchema } from "./airtrail";
import { APP_IN_THE_AIR_SIGNATURE, parseAppInTheAir } from "./appInTheAir";
import { parseFlighty } from "./flighty";
import { parseJetlog } from "./jetlog";
import { parseOpenFlights } from "./openflights";
import { TRACKER_FORMATS, TRACKER_SIGNATURES, type TrackerFormat } from "./formats";

/** Every format this entry point reads; FR24 too, so one drop zone takes any of them. */
export const DETECTABLE_FORMATS = [...TRACKER_FORMATS, "fr24"] as const;
export type DetectableFormat = (typeof DETECTABLE_FORMATS)[number];

export const FORMAT_SIGNATURES: Record<DetectableFormat, readonly string[]> = {
  ...TRACKER_SIGNATURES,
  fr24: ["Date", "Flight number", "From", "To", "Dep time", "Arr time", "Duration"],
};

const PARSERS: Record<DetectableFormat, (raw: string) => ParseResult> = {
  openflights: parseOpenFlights,
  airtrail: parseAirTrail,
  jetlog: parseJetlog,
  flighty: parseFlighty,
  app_in_the_air: parseAppInTheAir,
  fr24: parseFr24,
};

/** Header columns only one format writes — enough to tell the CSVs apart. */
const CSV_MARKERS: ReadonlyArray<[TrackerFormat | "fr24", readonly string[]]> = [
  ["openflights", ["Flight_Number", "From_OID", "Seat_Type"]],
  ["jetlog", ["origin", "destination", "ticket_class"]],
  ["flighty", ["Flight Flighty ID", "Gate Departure (Scheduled)", "Cabin Class"]],
  ["fr24", ["Flight number", "Dep time", "Arr time"]],
];

function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[");
}

function detectJson(text: string): DetectableFormat | null {
  try {
    return airTrailFileSchema.safeParse(JSON.parse(text)).success ? "airtrail" : null;
  } catch {
    // JSON that does not parse: AirTrail is the only JSON format read here,
    // and its parser says precisely what is wrong with the file.
    return "airtrail";
  }
}

export function detectTrackerFormat(raw: string): DetectableFormat | null {
  // trimStart also drops a byte-order mark (U+FEFF counts as white space to it).
  const text = raw.trimStart();
  if (looksLikeJson(text)) return detectJson(text);
  if (APP_IN_THE_AIR_SIGNATURE.test(text)) return "app_in_the_air";
  const header = new Set(parseCsvHeader(text));
  const hit = CSV_MARKERS.find(([, markers]) => markers.some((m) => header.has(m)));
  return hit ? hit[0] : null;
}

export interface TrackerParseResult extends ParseResult {
  /** The format the file was read as; null when nothing recognised it. */
  format: DetectableFormat | null;
  /** What each format is recognised by — sent with an unknown-format error. */
  expected?: Record<DetectableFormat, readonly string[]>;
}

export function parseTrackerExport(raw: string, format?: DetectableFormat): TrackerParseResult {
  const detected = format ?? detectTrackerFormat(raw);
  if (!detected) {
    const listed = DETECTABLE_FORMATS.map((f) => `${f} (${FORMAT_SIGNATURES[f].join(", ")})`);
    return {
      format: null,
      rows: [],
      parserErrors: [
        {
          rowIndex: -1,
          code: "unknownFormat",
          message: `Unrecognised file. Expected one of: ${listed.join("; ")}`,
        },
      ],
      expected: FORMAT_SIGNATURES,
    };
  }
  return { format: detected, ...PARSERS[detected](raw) };
}
