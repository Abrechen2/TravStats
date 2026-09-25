/**
 * How far a leg's endpoint (one of its two stops) may sit from the
 * nearest point of a candidate line before that line is refused as "does
 * not actually connect these two stops" — in kilometres.
 *
 * One number for two tour decisions that must agree: whether a hand-drawn
 * line survives its anchor check (`routes/trips/tourLegs.ts`) and whether a
 * recorded track is close enough to a leg's stops to adopt
 * (`services/tour/tracks/adoptTrack.ts`). Whether the editor OFFERS `track`
 * on a leg is decided from the same adoption rule on the server
 * (`services/trackCoverage/legCoverage.ts`, `GET …/legs/track-coverage`).
 *
 * Until 2.7 the frontend held a mirror of this constant, guarded by a drift
 * test, because it made that decision itself. It no longer does, so the
 * mirror and its guard are gone: a rule with one home cannot drift.
 *
 * Deliberately NOT the cruise tolerance (`CRUISE_TRACK_ANCHOR_KM`): a tour
 * stop is where the traveller stood, a cruise port is a catalogue point a
 * ship may anchor kilometres off. Also NOT shared with
 * `services/tour/routing/routeLeg.ts`'s own `ANCHOR_TOLERANCE_KM` (it
 * validates a routing provider's line — see its doc comment) nor with
 * `routes/cruises/routeOverride.ts`'s `ROUTE_ANCHOR_TOLERANCE_KM`.
 */
export const ANCHOR_TOLERANCE_KM = 1;
