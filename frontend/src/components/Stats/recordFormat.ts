import { formatDuration } from "../../lib/formatters";
import { formatDistance, localeForLanguage, type DistanceUnit } from "../../lib/units";
import type { TravelRecord } from "../../types/travelRecords";

/**
 * A record's number, turned into text — the whole reason `/stats/records`
 * sends a `value` and a `unit` instead of a sentence.
 *
 * The endpoint fixes neither the decimal separator, nor the distance unit, nor
 * the word order, because it cannot: the Companion reads it too, and a German
 * comma in a JSON body is a bug waiting for an English reader. So this is
 * where the reader's language and the reader's distance unit are applied, and
 * it is a pure function so a test can say what "12345 km" looks like in both
 * without rendering anything.
 *
 * `degrees-north` arrives UNROUNDED on purpose — the server refuses to decide
 * how many decimals a latitude deserves. One is the answer here: the record
 * names the point an airport sits at, and a tenth of a degree is already 11 km.
 */

export interface RecordFormatContext {
  distanceUnit: DistanceUnit;
  language: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function formatRecordValue(record: TravelRecord, ctx: RecordFormatContext): string {
  const { value, unit } = record;
  const locale = localeForLanguage(ctx.language);

  switch (unit) {
    case "km":
      return formatDistance(value, ctx.distanceUnit, ctx.t, ctx.language);
    case "minutes":
      return formatDuration(value);
    case "flights":
      return `${value.toLocaleString(locale)} ${ctx.t("stats:records.units.flights", { count: value })}`;
    case "days":
      return `${value.toLocaleString(locale)} ${ctx.t("stats:records.units.days", { count: value })}`;
    case "degrees-north":
      return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}° ${ctx.t("stats:records.units.north")}`;
    default:
      // The union is closed, but a payload is not the type system: a unit this
      // build does not know prints the bare number rather than "undefined".
      return value.toLocaleString(locale);
  }
}

/**
 * An airport, named where the account can name it and coded where it cannot.
 *
 * The payload carries IATA codes only — deliberately, since a localised
 * airport name in a shared JSON body is the same mistake as a formatted
 * number. The names come from the flight rows the page has already loaded, so
 * naming an airport costs no request and abstains cleanly when the code was
 * never seen on a flight.
 */
export function airportLabel(
  code: string | null | undefined,
  names: ReadonlyMap<string, string>
): string | null {
  if (!code) return null;
  const name = names.get(code.toUpperCase());
  return name ? `${code.toUpperCase()} · ${name}` : code.toUpperCase();
}

/**
 * A route, named where the account can name it — and always resolvable back to
 * the codes.
 *
 * The section used to print `MUC → SIN` while the card beside it wrote out
 * "Tromsø" for the northernmost point: the names were loaded, and three of the
 * four route cards ignored them. So `text` reads "München → Singapore Changi"
 * where both ends are known and falls back to the bare code per END, not per
 * route — one unknown airport must not cost the other its name.
 *
 * `codes` is the unabbreviated pair and is what the tile hangs in its `title`.
 * It is equal to `text` when nothing could be named, and a caller should then
 * skip the tooltip rather than repeat the line it is attached to.
 */
export interface RouteLabel {
  text: string;
  codes: string;
}

export function routeLabel(
  record: Pick<TravelRecord, "depIata" | "arrIata">,
  names: ReadonlyMap<string, string>
): RouteLabel | null {
  if (!record.depIata || !record.arrIata) return null;
  const from = record.depIata.toUpperCase();
  const to = record.arrIata.toUpperCase();
  return {
    text: `${names.get(from) ?? from} → ${names.get(to) ?? to}`,
    codes: `${from} → ${to}`,
  };
}
