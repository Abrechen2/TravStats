/**
 * Roster refs (spec 2026-10-20 F-S4e): how the home names a member of its own server in one
 * group's roster. A module of its own, free of imports, so the low-level key code can name an
 * entry's author without pulling in the federation services.
 */
import { createHash } from "crypto";

/** A member of the home's own server in this group's roster: uuid-shaped, never the account id. */
export function userRef(federatedRef: string, userId: string): string {
  const h = createHash("sha256").update(`travstats-roster|${federatedRef}|${userId}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
