/**
 * `GET /stats/domain-records` (forgejo#265) — MIRRORS
 * `backend/src/schemas/statsDomainRecords.ts`; change both together.
 */
export type DomainRecordId =
  | "longest-cruise"
  | "longest-stay"
  | "most-visited-place"
  | "longest-roadtrip"
  | "longest-rail-ride"
  | "longest-rental"
  | "longest-bus-ride";

export interface DomainRecord {
  domain: "cruise" | "lodging" | "poi" | "roadtrip" | "rail" | "rental" | "bus";
  /** A slug, not copy. */
  id: DomainRecordId;
  value: number;
  unit: "days" | "nights" | "visits" | "km";
  entryId: string;
  /** The page of the entry that holds the record. */
  href: string;
  /** The entry's own name — data, not copy. */
  label: string | null;
  /** For a distance: which distance it is (great_circle = straight line). */
  distanceSource?: string | null;
}
