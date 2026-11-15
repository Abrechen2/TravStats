/**
 * Which fields each domain's bulk edit takes (forgejo#405 A4).
 *
 * MIRRORED byte-for-byte in `frontend/src/shared/bulkEditFields.ts` (the
 * modal offers exactly these, the server accepts exactly these); change both
 * together — `bulkEditFields.mirror.test.ts` fails when they differ.
 */

export const DOMAIN_BULK_MAX = 200;

export const BULK_DOMAINS = ["rail", "bus", "ferry", "rental", "cruise", "stay"] as const;
export type BulkDomain = (typeof BULK_DOMAINS)[number];

export const BULK_FIELD_NAMES = [
  "trip",
  "tags",
  "companions",
  "status",
  "operator",
  "serviceClass",
] as const;
export type BulkField = (typeof BULK_FIELD_NAMES)[number];

export const BULK_FIELDS: Record<BulkDomain, readonly BulkField[]> = {
  rail: ["trip", "tags", "companions", "status", "operator", "serviceClass"],
  bus: ["trip", "tags", "companions", "status", "operator", "serviceClass"],
  ferry: ["trip", "tags", "companions", "status", "operator", "serviceClass"],
  rental: ["trip", "tags", "companions", "status"],
  cruise: ["trip", "tags", "companions", "status"],
  // A stay has no tags (its house has); its overall rating is derived from the
  // category ratings, so it is not offered here.
  stay: ["trip", "companions", "status"],
};
