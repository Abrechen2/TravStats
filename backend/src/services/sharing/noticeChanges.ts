import type { Prisma } from "../../prisma";
import {
  serializeTime,
  type LocalDateValue,
  type TimePrecision,
  type TimeValue,
} from "../../shared/time/wire";
import { fromJsonFact } from "./factValues";

/**
 * What an `updated` notice changed, shaped for display: one row per fact,
 * old value and new, each already in the API's time shapes (ADR 0002 D3) so
 * the inbox formats them with the app's own helpers and computes no zone.
 */

export type DisplayValue =
  | { kind: "time"; value: TimeValue }
  | { kind: "day"; value: LocalDateValue }
  | { kind: "wallClock"; value: string }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "list"; count: number }
  | { kind: "empty" }
  | { kind: "other" };

export interface NoticeChange {
  /** The fact's name; a house fact is `lodging.<name>`. */
  field: string;
  before: DisplayValue;
  after: DisplayValue;
}

/** `@db.Date` columns: a calendar day at the place, not an instant. */
const DAY_FIELDS = new Set([
  "checkInDate",
  "checkOutDate",
  "startDay",
  "endDay",
  "stopDate",
  "date",
]);

/**
 * The dual-write shadows of ADR 0002 phase 2: the old wall clock stored as if
 * it were UTC. Shown only when nothing else changed — beside their real
 * counterpart they would say the same thing twice.
 */
const SHADOW_FIELDS = new Set(["checkIn", "checkOut", "startDate", "endDate"]);

/** References a stop holds to other entries: they move with the entry, never alone of interest. */
const QUIET_FIELDS = new Set([...SHADOW_FIELDS, "sourceRef", "lodgingStayRef"]);

/** Fact → the precision column that qualifies it. */
const PRECISION_OF: Record<string, string> = {
  departureTime: "depPrecision",
  arrivalTime: "arrPrecision",
  pickupTime: "pickupPrecision",
  returnTime: "returnPrecision",
};

const asObject = (v: Prisma.JsonValue | null): Prisma.JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

function display(
  field: string,
  raw: unknown,
  zones: Record<string, string | null>,
  precisions: Record<string, unknown>
): DisplayValue {
  if (raw === null || raw === undefined || raw === "") return { kind: "empty" };
  if (raw instanceof Date) {
    if (DAY_FIELDS.has(field)) {
      return {
        kind: "day",
        value: {
          date: raw.toISOString().slice(0, 10),
          zone: zones[field] ?? null,
          precision: "day",
        },
      };
    }
    if (SHADOW_FIELDS.has(field)) return { kind: "wallClock", value: raw.toISOString() };
    const precisionField = PRECISION_OF[field];
    const precision = (
      precisionField && typeof precisions[precisionField] === "string"
        ? precisions[precisionField]
        : "minute"
    ) as TimePrecision;
    return { kind: "time", value: serializeTime(raw, zones[field] ?? null, precision) };
  }
  if (typeof raw === "string") return { kind: "text", value: raw };
  if (typeof raw === "number") return { kind: "number", value: raw };
  if (typeof raw === "boolean") return { kind: "boolean", value: raw };
  if (Array.isArray(raw)) return { kind: "list", count: raw.length };
  return { kind: "other" };
}

/** The changes of one `updated` notice, in a stable order; empty for any other kind. */
export function noticeChanges(
  before: Prisma.JsonValue | null,
  after: Prisma.JsonValue | null
): NoticeChange[] {
  const b = asObject(before);
  const a = asObject(after);
  const oldFacts = fromJsonFact(b.facts ?? {}) as Record<string, unknown>;
  const newFacts = fromJsonFact(a.facts ?? {}) as Record<string, unknown>;
  const zones = (fromJsonFact(a.zones ?? {}) ?? {}) as Record<string, string | null>;
  const oldZones = (fromJsonFact(b.zones ?? {}) ?? {}) as Record<string, string | null>;

  const rows: NoticeChange[] = [];
  for (const field of Object.keys(newFacts)) {
    const oldValue = oldFacts[field];
    const newValue = newFacts[field];
    if (field === "lodging" && newValue && typeof newValue === "object") {
      // The house, one row per house fact that differs.
      const oldHouse = (oldValue ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(newValue as Record<string, unknown>)) {
        if (key === "catalogueChainId") continue;
        if (JSON.stringify(oldHouse[key] ?? null) === JSON.stringify(value ?? null)) continue;
        rows.push({
          field: `lodging.${key}`,
          before: display(key, oldHouse[key], {}, {}),
          after: display(key, value, {}, {}),
        });
      }
      continue;
    }
    rows.push({
      field,
      before: display(field, oldValue, { ...zones, ...oldZones }, oldFacts),
      after: display(field, newValue, zones, newFacts),
    });
  }
  const visible = rows.filter((r) => !QUIET_FIELDS.has(r.field));
  return visible.length > 0 ? visible : rows;
}
