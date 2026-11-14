import type { ReadinessItem, ReadinessNote, ReadinessResponse } from "../../../lib/api/readiness";

/**
 * How the page orders what the server sent (spec §3.3 and §4 point 1):
 * muss, neu in X.Y, empfohlen, Braucht den Admin, bereit.
 *
 * Two rules the layout rests on:
 * - `unknown` is NEVER a muss. A check nobody has run is not a verified
 *   failure (spec §9), so it sits among the recommendations, marked
 *   "ungeprüft", with its own action (usually the test button).
 * - an item blocked by an admin item is the admin's to fix, for the viewer it
 *   is a statement, so it leaves the muss/empfohlen groups.
 */
export type ReadinessGroupId = "required" | "new" | "recommended" | "blocked" | "ready";

export const READINESS_GROUP_ORDER: readonly ReadinessGroupId[] = [
  "required",
  "new",
  "recommended",
  "blocked",
  "ready",
];

export interface ReadinessGroups {
  required: ReadinessItem[];
  new: ReadinessNote[];
  recommended: ReadinessItem[];
  blocked: ReadinessItem[];
  ready: ReadinessItem[];
  /** Snoozed or opted-out: out of the groups until the state ends or is cleared. */
  parked: ReadinessItem[];
}

/** A snooze ends by itself; an unreadable `until` counts as ended, so nothing stays hidden. */
export function isParked(item: ReadinessItem, nowMs: number): boolean {
  const state = item.userState;
  if (!state) return false;
  if (state.kind === "optedOut") return true;
  const until = Date.parse(state.until);
  return Number.isFinite(until) && until > nowMs;
}

export function groupReadiness(
  data: Pick<ReadinessResponse, "items" | "notes">,
  isAdmin: boolean,
  nowMs: number
): ReadinessGroups {
  const groups: ReadinessGroups = {
    required: [],
    new: data.notes.filter((n) => n.open),
    recommended: [],
    blocked: [],
    ready: [],
    parked: [],
  };
  for (const item of data.items) {
    if (item.status === "ready") {
      groups.ready.push(item);
    } else if (isParked(item, nowMs)) {
      groups.parked.push(item);
    } else if (item.blockedBy !== null && !(isAdmin && item.scope === "admin")) {
      groups.blocked.push(item);
    } else if (item.status === "needsAction" && item.severity === "required") {
      groups.required.push(item);
    } else {
      groups.recommended.push(item);
    }
  }
  return groups;
}

/**
 * The action an item may show THIS viewer. An item blocked by an admin item
 * shows no action to anyone but an admin, whatever the server put in the
 * field: an ordinary account must not be handed an address into the admin's
 * configuration (spec §2).
 */
export function actionFor(item: ReadinessItem, isAdmin: boolean): string | null {
  if (item.blockedBy !== null && !isAdmin) return null;
  return item.action;
}

/** `readiness.check.x.title` and `check.x.title` both name the key in the `readiness` namespace. */
export function readinessKey(key: string): string {
  if (key.includes(":")) return key;
  return `readiness:${key.replace(/^readiness\./, "")}`;
}
