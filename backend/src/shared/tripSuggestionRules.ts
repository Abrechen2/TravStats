/**
 * The trip-suggestion engine's rules: when the logbook says the user was away,
 * when an absence is a trip worth proposing, and when a dismissed proposal may
 * come back (owner decision 2026-09-26).
 *
 * ONE HOME. `services/tripSuggestions/` reads every threshold from here, and the
 * "does this entry count" question is answered by the same classifiers the
 * statistics use (`flightCounting`, `railCounting`, `cruiseCounting`,
 * `lodgingCounting`, `placeCounting`) — so a proposal can never call a
 * cancelled flight a journey, or a booked hotel a night that happened, while
 * the statistics page says otherwise.
 *
 * Everything here is pure.
 */

import { isCountableCruise } from "./cruiseCounting";
import { isCountableFlight } from "./flightCounting";
import { classifyStay } from "./lodgingCounting";
import { classifyVisit } from "./placeCounting";
import { isCountableRail } from "./railCounting";

/**
 * Farther than this from home is "away".
 *
 * Home is the home airport's coordinate — the only home position the account
 * stores. Airports sit outside the city they serve (MUC 28 km from Marienplatz,
 * BER 18 km, FRA 12 km), and a user lives somewhere in that city's metro area,
 * so the home radius must cover airport-to-suburb distances. 50 km does that
 * for every major European hub while a weekend in the next city (Augsburg is
 * 60 km from Munich, Nuremberg 150 km) is already away. A day trip inside the
 * radius is not a journey anyway, and one outside it is filtered by the night
 * rule below, not by this one.
 */
export const AWAY_KM = 50;

/**
 * An unrecorded night counts as away only this far from home.
 *
 * Two away points on consecutive days with no recorded return home in between
 * USUALLY mean a night away — but a user who drove 80 km to a lake on Saturday
 * and 90 km to a castle on Sunday went home in between and did not log the
 * drive. Beyond 150 km each way (three hours on the road for the round trip)
 * a same-day return is the exception, so the night is implied. Nights backed by
 * an entry — a stay, a cruise, a night train, a red-eye, a roadtrip station —
 * need no such inference and count at any distance.
 */
export const IMPLIED_NIGHT_KM = 150;

/**
 * Empty days bridged inside one absence.
 *
 * A hotel check-out on Tuesday and the next check-in on Thursday, with an
 * unrecorded drive between them, is one journey; three silent days usually
 * mean the user was home and did not record the trip back. A RECORDED return
 * home splits an absence however short the gap — the bridge only ever covers
 * silence.
 */
export const BRIDGE_DAYS = 2;

/**
 * A home-airport arrival followed by a departure within this many hours is a
 * change of planes, not a return — the rule `places/visitSuggestions.ts` uses
 * for a layover, for the same reason: a hub flyer connecting through home was
 * never home.
 */
export const HOME_LAYOVER_HOURS = 6;

/** The owner's threshold: at least one night away AND at least two entries. */
export const MIN_NIGHTS_AWAY = 1;
export const MIN_NEW_TRIP_ENTRIES = 2;

/** An existing trip's window is its span widened by this many days each side. */
export const TRIP_WINDOW_PAD_DAYS = 1;

/**
 * Without a known home, an entry inside a trip's window belongs to it only when
 * it lies this close to something the trip already holds — a regional trip's
 * reach, the same order as the photo scan's airport range.
 */
export const TRIP_PLAUSIBLE_KM = 300;

/**
 * "An diesem Tag warst du hier": an own place this close to where the user
 * slept, docked or changed trains.
 *
 * About twelve minutes on foot. The checklist matcher (`visitSuggestions.ts`)
 * reaches 15–40 km because a world-heritage target is what you came to a town
 * to see; an own place is a café, a museum, a viewpoint, and a hotel two
 * kilometres from it says nothing about having gone in.
 */
export const PLACE_VISIT_NEAR_KM = 1;

/**
 * A dismissed proposal returns only when its member set has materially
 * changed: when fewer than half of the entries it now carries were already in
 * the set the user said no to (Jaccard similarity below 0.5). One added hotel
 * does not re-ask the question; a second week of travel appended to a
 * dismissed weekend does.
 */
export const MATERIAL_CHANGE_JACCARD = 0.5;

// ---------------------------------------------------------------- counting

/** What an entry says about the user's presence. */
export type PresenceState = "happened" | "planned" | "excluded";

/** A flight: flown/historical happened, scheduled is planned, the rest never. */
export function flightPresence(flight: { status: string }): PresenceState {
  if (isCountableFlight(flight)) return "happened";
  return flight.status === "scheduled" ? "planned" : "excluded";
}

/** A ride: completed happened, cancelled never, anything else is ahead. */
export function railPresence(ride: { status: string }): PresenceState {
  if (isCountableRail(ride)) return "happened";
  return ride.status === "cancelled" ? "excluded" : "planned";
}

/** A cruise: flown/historical happened, cancelled never, the rest is ahead. */
export function cruisePresence(cruise: { status: string }): PresenceState {
  if (isCountableCruise(cruise)) return "happened";
  return cruise.status === "cancelled" ? "excluded" : "planned";
}

/**
 * A stay, by the statistics' own rule: it has happened once check-out is past.
 * A stay of a lodging on the wishlist (`visited = false`) never counts.
 */
export function stayPresence(
  stay: Parameters<typeof classifyStay>[0],
  lodgingVisited: boolean,
  now?: Date
): PresenceState {
  if (!lodgingVisited) return "excluded";
  const state = classifyStay(stay, now);
  if (state === "visited") return "happened";
  return state === "planned" ? "planned" : "excluded";
}

/** A place visit, by `classifyVisit`: a future-dated one is a plan. */
export function visitPresence(visit: { visitedAt: Date | null }, now?: Date): PresenceState {
  return classifyVisit(visit, now) === "visited" ? "happened" : "planned";
}

/**
 * A dated station or tour point: its day against today in the user's profile
 * zone (ADR 0002, D4) — both are `YYYY-MM-DD` keys, so the comparison is a
 * string one. Today itself is still in progress, so it counts as happened.
 */
export function datedPresence(day: string, today: string): PresenceState {
  return day <= today ? "happened" : "planned";
}

// ---------------------------------------------------------------- dismissal

/** |A ∩ B| / |A ∪ B|, and 1 for two empty sets. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const key of left) if (right.has(key)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Whether a proposal differs enough from an answered one to be asked again. */
export function isMaterialChange(answered: readonly string[], current: readonly string[]): boolean {
  return jaccard(answered, current) < MATERIAL_CHANGE_JACCARD;
}
