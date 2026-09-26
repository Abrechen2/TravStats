import { z } from "../../schemas/zod";
import type { Fold } from "./instant";
import { isLocalDate } from "./localDate";
import { localTimeAtPlaceInputSchema, localTimeInputSchema, type PlaceRefKind } from "./wire";

/**
 * Inbound time fields (ADR 0002 D3, phase 2): what a write body may carry
 * where a time or a day used to be a free datetime string.
 *
 * The rule the schemas enforce is what they REFUSE. An offset-less datetime
 * (`2027-03-28T10:00`) was parsed with `new Date(v)`, so the server's own zone
 * decided what was stored; it is now refused with `TIME_SHAPE_REQUIRED`. What
 * is accepted:
 *
 * - `{local, zone}` / `{local, placeRef}` — the wall clock as the ticket shows
 *   it, converted once, by the server, with `toInstant`;
 * - an offset-bearing ISO string — a machine instant, from clients that
 *   predate the shape. On a field that used to hold a fake-UTC wall clock the
 *   route refuses a bare `Z` from a browser session (a cached bundle) but
 *   accepts it from a token (the Companion writes real instants) — that
 *   decision needs the request, so it is `resolveInput.ts`'s, not this file's;
 * - `YYYY-MM-DD` where a field may be known only to the day.
 */

export type TimeFieldInput =
  | {
      kind: "local";
      local: string;
      zone?: string;
      placeRef?: { kind: PlaceRefKind; id: string };
      fold?: Fold;
    }
  | {
      kind: "instant";
      utc: Date;
      /** Written with a literal `Z` — the shape a fake-UTC web write had. */
      bareZ: boolean;
    }
  | { kind: "date"; date: string };

/** An ISO datetime WITH an offset or `Z`: the date part, and whether it is `Z`. */
const OFFSET_ISO =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;
/** A datetime with NO offset — the host would decide what it means. */
const OFFSETLESS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

const SHAPE_REQUIRED = "TIME_SHAPE_REQUIRED";

function offsetInstant(value: string): { date: string; utc: Date; bareZ: boolean } | null {
  const match = OFFSET_ISO.exec(value);
  if (!match || !isLocalDate(match[1])) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return { date: match[1], utc: new Date(ms), bareZ: match[2].toUpperCase() === "Z" };
}

export interface TimeFieldOptions {
  /** Accept `YYYY-MM-DD` for a value known only to the day (precision `day`). */
  allowDate?: boolean;
  /**
   * The entity already names a place (a visit's place, a stop's port), so
   * `{local}` may leave out both `zone` and `placeRef`.
   */
  impliedPlace?: boolean;
}

/** An instant-kind field: a typed wall clock, a machine instant, or (optionally) a day. */
export function timeFieldSchema(options: TimeFieldOptions = {}) {
  const objectShape = options.impliedPlace ? localTimeAtPlaceInputSchema : localTimeInputSchema;
  return z
    .union([objectShape, z.string()])
    .transform((value, ctx): TimeFieldInput => {
      if (typeof value === "object") return { kind: "local", ...value };
      if (isLocalDate(value)) {
        if (options.allowDate) return { kind: "date", date: value };
        ctx.addIssue({ code: "custom", message: SHAPE_REQUIRED });
        return z.NEVER;
      }
      const instant = offsetInstant(value);
      if (instant) return { kind: "instant", utc: instant.utc, bareZ: instant.bareZ };
      ctx.addIssue({
        code: "custom",
        message: OFFSETLESS.test(value) ? SHAPE_REQUIRED : "not a time value",
      });
      return z.NEVER;
    })
    .openapi({
      description:
        "`LocalTimeInput` ({local, zone} or {local, placeRef}), or an offset-bearing ISO " +
        "instant from clients that predate it" +
        (options.allowDate ? ", or `YYYY-MM-DD` for a value known only to the day" : "") +
        ". An offset-less datetime string is refused with 422 TIME_SHAPE_REQUIRED.",
    });
}

/**
 * A calendar-day field: `YYYY-MM-DD`. An offset-bearing ISO string from a
 * client that predates the shape is read as the day it WRITES (the date part),
 * which is what every such client meant by the UTC midnight it sent; an
 * offset-less datetime is refused. The output is always `YYYY-MM-DD`.
 */
export function dayFieldSchema() {
  return z
    .string()
    .transform((value, ctx): string => {
      if (isLocalDate(value)) return value;
      const instant = offsetInstant(value);
      if (instant) return instant.date;
      ctx.addIssue({
        code: "custom",
        message: OFFSETLESS.test(value) ? SHAPE_REQUIRED : "date must be a real YYYY-MM-DD",
      });
      return z.NEVER;
    })
    .openapi({
      description:
        "`LocalDateInput` (`YYYY-MM-DD`). An offset-bearing ISO string is read as the day " +
        "it writes; an offset-less datetime is refused with 422 TIME_SHAPE_REQUIRED.",
      example: "2027-05-02",
    });
}

/**
 * `dayFieldSchema` for a legacy DAY column (phase 2 dual-write): the day,
 * handed on as the UTC-midnight ISO instant those columns have always held,
 * so the code below the schema — FX, nights, status — keeps reading what it
 * read. The new `DATE` column is derived from the same value.
 */
export function legacyDayFieldSchema() {
  return dayFieldSchema().transform((day) => `${day}T00:00:00.000Z`);
}
