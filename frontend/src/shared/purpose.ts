/**
 * Private or business — the one rule behind the `purpose` marker
 * (docs/superpowers/specs/2026-11-22-private-business-purpose.md).
 *
 * Mirrored at frontend/src/shared/purpose.ts — change both together; each side has its own test
 * asserting the same truth table.
 *
 * `null` is "unknown", never "private": every row older than the field has no purpose, and a
 * purpose filter must never hide what it cannot classify.
 */

export const PURPOSES = ["private", "business"] as const;
export type Purpose = (typeof PURPOSES)[number];

/** The domains whose entries carry a purpose, in the names of `DomainKey`. */
export const PURPOSE_DOMAINS = [
  "poi",
  "flight",
  "lodging",
  "rail",
  "bus",
  "ferry",
  "rental",
  "cruise",
] as const;
export type PurposeDomain = (typeof PURPOSE_DOMAINS)[number];

/** Per domain, the purposes the user hides. A missing domain hides nothing. */
export type PurposeVisibility = Partial<Record<PurposeDomain, Purpose[]>>;

export const isPurpose = (v: unknown): v is Purpose =>
  typeof v === "string" && (PURPOSES as readonly string[]).includes(v);

/**
 * The purpose a new entry takes from the trip it is created in. A trip is only a starting point:
 * the entry keeps its own value afterwards (no live link). `other` and no category say nothing.
 */
export function purposeFromTripCategory(category: string | null | undefined): Purpose | null {
  switch (category) {
    case "business":
      return "business";
    case "vacation":
    case "weekend":
    case "family":
      return "private";
    default:
      return null;
  }
}

/** Is an entry with this purpose left out by `hidden`? Unknown is never hidden. */
export function isHiddenByPurpose(
  purpose: string | null | undefined,
  hidden: readonly string[] | undefined
): boolean {
  return !!purpose && !!hidden && hidden.includes(purpose);
}
