import { RATE_LIMITS } from "../../../config/constants";

/**
 * ONE daily budget for every call to the instance's routing provider (the key
 * and its quota belong to the whole instance, not to a user). Checked BEFORE
 * the call; a spent budget reads as `rate_limited`, the same reason the
 * provider's own 429 gives, so every client already words it.
 *
 * Per-user and instance-wide, both per UTC day. A request limiter bounds how
 * often an endpoint may be hit; this bounds what the hits may SPEND — a save
 * that routes, a "route again" and a bulk pass all draw from the same counter.
 */

export type BudgetVerdict = "ok" | "user_cap" | "instance_cap";

interface Day {
  key: string;
  instance: number;
  perUser: Map<string, number>;
}

let today: Day = { key: "", instance: 0, perUser: new Map() };

const dayKey = (now: Date): string => now.toISOString().slice(0, 10);

/** Reserve one provider call for `userId`, or say which cap refuses it. */
export function takeProviderCall(userId: string, now: Date = new Date()): BudgetVerdict {
  const key = dayKey(now);
  if (today.key !== key) today = { key, instance: 0, perUser: new Map() };
  const used = today.perUser.get(userId) ?? 0;
  if (used >= RATE_LIMITS.ROUTING_CALLS_PER_USER_PER_DAY) return "user_cap";
  if (today.instance >= RATE_LIMITS.ROUTING_CALLS_PER_INSTANCE_PER_DAY) return "instance_cap";
  today.perUser.set(userId, used + 1);
  today.instance += 1;
  return "ok";
}

/** Test seam. */
export function resetProviderBudget(): void {
  today = { key: "", instance: 0, perUser: new Map() };
}
