import { z } from "../../schemas/zod";
import { toLocal } from "./instant";
import { isLocalDate } from "./localDate";
import { isValidZone } from "./zonedParts";

/**
 * The time shapes on the wire (ADR 0002 D3) — published in phase 1 so the
 * phase 2 write paths, the web and the Companion build against one
 * definition. The inbound field schemas that use them are in `timeInput.ts`.
 *
 * IN: what the ticket says — `{local, zone}` or `{local, placeRef}` — never an
 * offset-less datetime string, which the host would parse in its own zone.
 * OUT: `{utc, zone, offset, local, precision}`; clients display `local` as is
 * and use `utc` only to sort and to measure.
 */

/** How exact a value is. `unknown` keeps the date and drops the time of day (Q4). */
export const TIME_PRECISIONS = ["minute", "day", "month", "year", "unknown"] as const;
export type TimePrecision = (typeof TIME_PRECISIONS)[number];

/** A catalogue row or user place whose zone the server resolves (`resolveZone`). */
export const PLACE_REF_KINDS = ["airport", "railStation", "port", "place"] as const;
export type PlaceRefKind = (typeof PLACE_REF_KINDS)[number];

const LOCAL_WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const LOCAL_TIME_INPUT_DESCRIPTION =
  "A wall clock as the ticket shows it (ADR 0002 D3) and where its zone comes from: " +
  "`zone` (IANA) or `placeRef` (a catalogue row or place the server resolves) — exactly one, " +
  "except on a field whose entity already names a place (a visit, a port call, a trip stop), " +
  "where both may be left out and the server reads that place's zone. " +
  "`fold: later` picks the second occurrence of a repeated autumn hour.";

/** The fields of a typed time, before the rule on where its zone comes from. */
export const localTimeInputBaseSchema = z.strictObject({
  local: z.string().regex(LOCAL_WALL_CLOCK, "local must be YYYY-MM-DDTHH:mm[:ss] without offset"),
  zone: z
    .string()
    .refine((zone) => isValidZone(zone), "ZONE_UNKNOWN")
    .optional(),
  placeRef: z.strictObject({ kind: z.enum(PLACE_REF_KINDS), id: z.string().min(1) }).optional(),
  fold: z.enum(["earlier", "later"]).optional(),
});

export const localTimeInputSchema = localTimeInputBaseSchema
  // Exactly one source of the zone: two could disagree, none would leave the
  // server to guess — which is the fallback D2 abolishes.
  .refine((v) => (v.zone === undefined) !== (v.placeRef === undefined), {
    message: "exactly one of zone or placeRef",
  })
  .openapi("LocalTimeInput", { description: LOCAL_TIME_INPUT_DESCRIPTION });

/**
 * The same shape for a field whose ENTITY already names a place — a visit to
 * a place, a call at a port, a stay at a hotel: `zone` and `placeRef` may
 * both be left out, and the server reads the zone of that place. At most one,
 * still: two could disagree.
 */
export const localTimeAtPlaceInputSchema = localTimeInputBaseSchema
  .refine((v) => v.zone === undefined || v.placeRef === undefined, {
    message: "at most one of zone or placeRef",
  })
  // The same JSON shape as `LocalTimeInput` (a refine is invisible to JSON
  // Schema), so the spec points at the one component; each field's own
  // description says whether the zone may be left to the entity's place.
  .openapi("LocalTimeInput", { description: LOCAL_TIME_INPUT_DESCRIPTION });
export type LocalTimeInput = z.infer<typeof localTimeInputSchema>;

/** A calendar day, `YYYY-MM-DD` — a real one (2027-02-29 is refused). */
export const localDateInputSchema = z
  .string()
  .refine(isLocalDate, "date must be a real YYYY-MM-DD")
  .openapi("LocalDateInput", {
    description: "A calendar day at the place, `YYYY-MM-DD` (ADR 0002 D1).",
    example: "2027-05-02",
  });

export interface TimeValue {
  /** RFC 3339 instant in UTC. */
  utc: string;
  /** IANA zone of the place, frozen at write time. */
  zone: string;
  /** Offset in force at `utc`, e.g. `+05:45` — enough to build an RFC 3339 string without a zone library. */
  offset: string;
  /** `YYYY-MM-DDTHH:mm:ss` as the place's clock showed it. */
  local: string;
  precision: TimePrecision;
}

export interface LocalDateValue {
  /** `YYYY-MM-DD`. */
  date: string;
  /** The zone the day belongs to; null for a floating date (a birthday). */
  zone: string | null;
  precision: Exclude<TimePrecision, "minute">;
}

/** The outbound shape of an instant stored with its place's zone. */
export function serializeTime(
  utc: Date,
  zone: string,
  precision: TimePrecision = "minute"
): TimeValue {
  const { local, offset } = toLocal(utc, zone);
  return { utc: utc.toISOString(), zone, offset, local, precision };
}
