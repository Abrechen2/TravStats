/** The purpose fields every entry row carries (spec 2026-11-22-private-business-purpose.md). */
export interface PurposeFields {
  /** Private or business; null is unknown, absent on older servers. */
  purpose?: "private" | "business" | null;
  /** The detailed purpose beside the kind (`builtin:…` | `custom:…`); null: the kind alone. */
  purposeKey?: string | null;
}
