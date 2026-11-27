import logger from "../../../utils/logger";
import type { RouteFallbackReason, RoutingProviderId } from "./types";

/**
 * Which routing providers refused this instance lately, so a dead one stops
 * being asked and the refusal reaches the admin instead of a log line (#411).
 *
 * A provider is DOWN after a refusal of the key itself (`auth`: 401/403, and
 * 410 Gone, which ORS answers for a key or plan it no longer serves) or after
 * `PROVIDER_ERROR_STREAK` provider errors or 429s in a row with no success between —
 * never after a single miss (`no_route`, `point_not_near_road`, …), which says
 * something about one leg and nothing about the provider. Any routed answer
 * clears it; so does the TTL, so a provider that recovers is tried again.
 *
 * State is kept per CREDENTIAL, not per provider: `scope` is `instance` for the
 * instance key or self-hosted URL, `user:<id>` for an account's own key. Only
 * the instance scope feeds the automatic skip for everyone and the readiness
 * item; an account's refused key affects that account alone.
 *
 * Process memory on purpose: it describes the provider's state right now, not
 * a fact about the data, and a restart that forgets it costs one more refusal.
 */

/** How long a refusal keeps a provider out of the automatic choice. */
export const PROVIDER_DOWN_TTL_MS = 30 * 60 * 1000;
/** Provider errors in a row (no success between) that count as the provider being down. */
export const PROVIDER_ERROR_STREAK = 3;

/** The instance's own credential (instance key or self-hosted URL). */
export const INSTANCE_SCOPE = "instance";

export interface ProviderDown {
  providerId: RoutingProviderId;
  scope: string;
  reason: RouteFallbackReason;
  since: Date;
}

interface Entry {
  errorStreak: number;
  down: ProviderDown | null;
}

const entries = new Map<string, Entry>();
const keyOf = (id: RoutingProviderId, scope: string): string => `${id}|${scope}`;

function entryOf(key: string): Entry {
  const existing = entries.get(key);
  if (existing) return existing;
  const fresh: Entry = { errorStreak: 0, down: null };
  entries.set(key, fresh);
  return fresh;
}

/** Records the outcome of one provider request (`null` reason = it routed). */
export function recordProviderOutcome(
  id: RoutingProviderId,
  reason: RouteFallbackReason | null,
  now: Date = new Date(),
  scope: string = INSTANCE_SCOPE
): void {
  const key = keyOf(id, scope);
  const entry = entryOf(key);
  if (reason === null) {
    entries.set(key, { errorStreak: 0, down: null });
    return;
  }
  if (reason === "auth") {
    markDown(key, id, scope, entry, reason, now);
    return;
  }
  // A provider error or a provider-side 429 (quota) in a row: the provider, not one leg.
  if (reason === "provider_error" || reason === "rate_limited") {
    const streak = entry.errorStreak + 1;
    entries.set(key, { ...entry, errorStreak: streak });
    if (streak >= PROVIDER_ERROR_STREAK) markDown(key, id, scope, entries.get(key)!, reason, now);
  }
}

function markDown(
  key: string,
  id: RoutingProviderId,
  scope: string,
  entry: Entry,
  reason: RouteFallbackReason,
  now: Date
): void {
  if (entry.down === null) {
    // A console-visible line once per outage, not per leg. The scope names no user.
    logger.warn(
      {
        operation: "routing.provider_down",
        providerId: id,
        instanceKey: scope === INSTANCE_SCOPE,
        reason,
      },
      "routing provider refuses requests; legs fall back to straight lines until it answers again"
    );
  }
  entries.set(key, {
    ...entry,
    down: { providerId: id, scope, reason, since: entry.down?.since ?? now },
  });
}

/** The outage of this credential, or null while it answers (or the outage is older than the TTL). */
export function providerDown(
  id: RoutingProviderId,
  now: Date = new Date(),
  scope: string = INSTANCE_SCOPE
): ProviderDown | null {
  const key = keyOf(id, scope);
  const down = entries.get(key)?.down ?? null;
  if (down === null) return null;
  if (now.getTime() - down.since.getTime() > PROVIDER_DOWN_TTL_MS) {
    entries.set(key, { errorStreak: 0, down: null });
    return null;
  }
  return down;
}

/** Every provider whose INSTANCE credential is currently down (accounts' own keys never count). */
export function downProviders(now: Date = new Date()): ProviderDown[] {
  return [...entries.values()].flatMap((entry) => {
    const d = entry.down;
    if (!d || d.scope !== INSTANCE_SCOPE) return [];
    const live = providerDown(d.providerId, now, d.scope);
    return live ? [live] : [];
  });
}

/** Tests only: forget every outcome. */
export function resetProviderHealth(): void {
  entries.clear();
}
