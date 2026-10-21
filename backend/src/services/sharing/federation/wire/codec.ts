/**
 * The building blocks of the trip-share wire's entry facts (spec 2026-10-20 §4, §6): one codec
 * per column kind, each a strict Zod reader for what arrives and the encoder for what leaves.
 *
 * Time (ADR 0002): an instant travels as ISO-8601 with `Z` — an offset-less or offset datetime
 * is refused (D3) — and is read back as the same instant; a local calendar day travels as
 * `YYYY-MM-DD` and is read back as the UTC-midnight `@db.Date` value Prisma stores. Zones are
 * plain facts beside them and are never re-derived on either side (D2).
 */
import { z } from "../../../../schemas/zod";
import { lat, lon, requiredZone, zone } from "../../../trip/exchange/publicHalf";

export interface Codec {
  /** What the receiver accepts; transforms to the value Prisma stores. */
  readonly wire: z.ZodType;
  /** The stored value as it travels. */
  encode(value: unknown): unknown;
}

const same = (value: unknown): unknown => value;
const codec = (wire: z.ZodType, encode: (value: unknown) => unknown = same): Codec => ({
  wire,
  encode,
});

const isoInstant = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)), "not a calendar day");

export const text = (max = 500) => codec(z.string().max(max));
export const name = (max = 300) => codec(z.string().min(1).max(max));
export const optText = (max = 500) => codec(z.string().max(max).nullable());
export const num = codec(z.number().finite());
export const optNum = codec(z.number().finite().nullable());
export const int = codec(z.number().int().min(-1_000_000).max(100_000_000));
export const optInt = codec(z.number().int().min(-1_000_000).max(100_000_000).nullable());
export const bool = codec(z.boolean());
export const optBool = codec(z.boolean().nullable());
export const latitude = codec(lat);
export const longitude = codec(lon);
export const optLatitude = codec(lat.nullable());
export const optLongitude = codec(lon.nullable());
export const timeZone = codec(zone);
export const requiredTimeZone = codec(requiredZone);
export const instant = codec(
  z.iso.datetime().transform((s) => new Date(s)),
  isoInstant
);
export const optInstant = codec(
  z.iso
    .datetime()
    .nullable()
    .transform((s) => (s === null ? null : new Date(s))),
  isoInstant
);
export const optDay = codec(
  dayString.nullable().transform((s) => (s === null ? null : new Date(`${s}T00:00:00.000Z`))),
  isoDay
);
export const strings = codec(z.array(z.string().max(200)).max(300));
/** A status word. Advisory only: the receiver re-derives it (`receivedStatus`). */
export const status = codec(z.string().min(1).max(40));
/** Free JSON a fact column holds (a flight's `specialData`); the message budget bounds it. */
export const json = codec(z.json().nullable());

/**
 * A line on the map (`actualRoute`, a rail, road or sea `geometry`) longer than this travels
 * without its geometry, and the receiver's copy shows the straight line — a stated loss (spec
 * §4), not a silent re-derivation.
 */
export const MAX_GEOMETRY_POINTS = 5_000;

/** Coordinate pairs anywhere in a GeoJSON-ish value: every array that starts with two numbers. */
export function countPoints(value: unknown): number {
  if (!Array.isArray(value)) {
    if (value && typeof value === "object")
      return Object.values(value).reduce<number>((n, v) => n + countPoints(v), 0);
    return 0;
  }
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") return 1;
  return value.reduce<number>((n, v) => n + countPoints(v), 0);
}

export const geometry = codec(z.json().nullable(), (v) =>
  countPoints(v) > MAX_GEOMETRY_POINTS ? null : v
);

/** A codec for a nested strict object built from a shape of codecs. */
export function object(shape: Readonly<Record<string, Codec>>, nullable = false): Codec {
  const schema = z.strictObject(
    Object.fromEntries(Object.entries(shape).map(([k, c]) => [k, c.wire]))
  );
  const encode = (value: unknown) =>
    value === null || value === undefined
      ? null
      : encodeShape(shape, value as Record<string, unknown>);
  return codec(nullable ? schema.nullable() : schema, encode);
}

export function list(item: Codec, max: number): Codec {
  return codec(z.array(item.wire).max(max), (v) => (v as unknown[]).map((x) => item.encode(x)));
}

/** A ready reader, not a codec: for a reference that arrives already in wire form. */
export const readOnly = (wire: z.ZodType): Codec => codec(wire);

/**
 * The wire form of `facts`: exactly the shape's keys, each encoded — a whitelist, so a column a
 * row carries beyond the shape (a seat, a price, a note) cannot leave this server.
 */
export function encodeShape(
  shape: Readonly<Record<string, Codec>>,
  facts: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, c]) => [key, c.encode(facts[key] ?? null)])
  );
}

export const strictShape = (shape: Readonly<Record<string, Codec>>) =>
  z.strictObject(Object.fromEntries(Object.entries(shape).map(([k, c]) => [k, c.wire])));
