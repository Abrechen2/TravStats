import type { Prisma } from "../../prisma";

/**
 * Fact values as they travel through propagation and notices.
 *
 * A notice stores the values it changed (`before`/`after`, JSON) so that undo
 * can put them back exactly — which means a `Date` has to survive the trip
 * through a JSON column. It is tagged `{ $date: iso }` on the way in and
 * revived on the way out; every other value is JSON already.
 */

export type FactRecord = Record<string, unknown>;

interface TaggedDate {
  $date: string;
}

const isTaggedDate = (v: unknown): v is TaggedDate =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length === 1 &&
  typeof (v as { $date?: unknown }).$date === "string";

/** A value made JSON-safe: Dates tagged, objects with sorted keys. */
export function toJsonFact(value: unknown): Prisma.JsonValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(toJsonFact);
  if (typeof value === "object") {
    const out: Record<string, Prisma.JsonValue> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = toJsonFact((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  return value as Prisma.JsonValue;
}

/** The inverse of `toJsonFact`: tagged dates become Dates again. */
export function fromJsonFact(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (isTaggedDate(value)) return new Date(value.$date);
  if (Array.isArray(value)) return value.map(fromJsonFact);
  if (typeof value === "object") {
    const out: FactRecord = {};
    for (const [key, inner] of Object.entries(value as object)) out[key] = fromJsonFact(inner);
    return out;
  }
  return value;
}

/** Deep equality on the JSON form: two Dates of one instant are equal, key order is not identity. */
export function sameFact(a: unknown, b: unknown): boolean {
  return JSON.stringify(toJsonFact(a)) === JSON.stringify(toJsonFact(b));
}

/** The keys of `fields` whose values differ between `a` and `b`. */
export function changedKeys(a: FactRecord, b: FactRecord, fields: readonly string[]): string[] {
  return fields.filter((field) => !sameFact(a[field], b[field]));
}

/** `record` restricted to `keys`, JSON-safe — what a notice stores. */
export function jsonSubset(record: FactRecord, keys: readonly string[]): Prisma.JsonObject {
  const out: Prisma.JsonObject = {};
  for (const key of keys) out[key] = toJsonFact(record[key]);
  return out;
}

/** A notice's stored values, revived for a write. */
export function revivedRecord(json: Prisma.JsonValue | null | undefined): FactRecord {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  return fromJsonFact(json) as FactRecord;
}
