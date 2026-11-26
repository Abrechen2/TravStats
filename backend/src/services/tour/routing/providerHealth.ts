import logger from "../../../utils/logger";
import type { RouteFallbackReason, RoutingProviderId } from "./types";

/**
 * Which routing providers refused this instance lately, so a dead one stops
 * being asked and the refusal reaches the admin instead of a log line (#411).
 *
 * A provider is DOWN after a refusal of the key itself (`auth`: 401/403, and
 * 410 Gone, which ORS answers for a key or plan it no longer serves) or after
 * `PROVIDER_ERROR_STREAK` provider errors in a row with no success between —
 * never after a single miss (`no_route`, `point_not_near_road`, …), which says
 * something about one leg and nothing about the provider. Any routed answer
 * clears it; so does the TTL, so a provider that recovers is tried again.
 *
 * Process memory on purpose: it describes the provider's state right now, not
 * a fact about the data, and a restart that forgets it costs one more refusal.
 */

/** How long a refusal keeps a provider out of the automatic choice. */
export const PROVIDER_DOWN_TTL_MS = 30 * 60 * 1000;
/** Provider errors in a row (no success between) that count as the provider being down. */
export const PROVIDER_ERROR_STREAK = 3;

export interface ProviderDown {
  providerId: RoutingProviderId;
  reason: RouteFallbackReason;
  since: Date;
}

interface Entry {
  errorStreak: number;
  down: ProviderDown | null;
}

const entries = new Map<RoutingProviderId, Entry>();

function entryOf(id: RoutingProviderId): Entry {
  const existing = entries.get(id);
  if (existing) return existing;
  const fresh: Entry = { errorStreak: 0, down: null };
  entries.set(id, fresh);
  return fresh;
}

/** Records the outcome of one provider request (`null` reason = it routed). */
export function recordProviderOutcome(
  id: RoutingProviderId,
  reason: RouteFallbackReason | null,
  now: Date = new Date()
): void {
  const entry = entryOf(id);
  if (reason === null) {
    entries.set(id, { errorStreak: 0, down: null });
    return;
  }
  if (reason === "auth") {
    markDown(id, entry, reason, now);
    return;
  }
  if (reason === "provider_error") {
    const streak = entry.errorStreak + 1;
    entries.set(id, { ...entry, errorStreak: streak });
    if (streak >= PROVIDER_ERROR_STREAK) markDown(id, entries.get(id)!, reason, now);
  }
}

function markDown(
  id: RoutingProviderId,
  entry: Entry,
  reason: RouteFallbackReason,
  now: Date
): void {
  if (entry.down === null) {
    // A console-visible line once per outage, not per leg.
    logger.warn(
      { operation: "routing.provider_down", providerId: id, reason },
      "routing provider refuses requests; legs fall back to straight lines until it answers again"
    );
  }
  entries.set(id, { ...entry, down: { providerId: id, reason, since: entry.down?.since ?? now } });
}

/** The provider's outage, or null while it answers (or its outage is older than the TTL). */
export function providerDown(id: RoutingProviderId, now: Date = new Date()): ProviderDown | null {
  const down = entries.get(id)?.down ?? null;
  if (down === null) return null;
  if (now.getTime() - down.since.getTime() > PROVIDER_DOWN_TTL_MS) {
    entries.set(id, { errorStreak: 0, down: null });
    return null;
  }
  return down;
}

/** Every provider currently down. */
export function downProviders(now: Date = new Date()): ProviderDown[] {
  return [...entries.keys()].flatMap((id) => {
    const down = providerDown(id, now);
    return down ? [down] : [];
  });
}

/** Tests only: forget every outcome. */
export function resetProviderHealth(): void {
  entries.clear();
}
