/**
 * How far a leg's endpoint (one of its two stops) may sit from the
 * nearest point of a candidate line before that line is refused as "does
 * not actually connect these two stops" — in kilometres.
 *
 * Shared across the frontend/backend boundary because the SAME literal
 * decides two things that must agree: whether a hand-drawn line survives
 * its anchor check (`routes/trips/tourLegs.ts`) and whether a recorded
 * track's geometry is close enough to a leg's stops to adopt
 * (`services/tour/tracks/adoptTrack.ts`) on the backend, AND whether the
 * frontend even offers the `track` leg-source option in the first place
 * (`frontend/src/lib/trackCoverage.ts`). A UI that offers `track` on a
 * leg the server would refuse — or hides it on one the server would
 * accept — is exactly the drift a hand-copied number invites, silently,
 * because both sides' tests stay green either way.
 *
 * Mirrored at `frontend/src/shared/tour/anchorTolerance.ts`. Keep the two
 * in sync manually — enforced by this module's own guard test
 * (`__tests__/anchorTolerance.test.ts`), which fails loudly if the values
 * diverge.
 *
 * Deliberately NOT shared with `services/tour/routing/routeLeg.ts`'s own
 * `ANCHOR_TOLERANCE_KM` — that constant validates a ROUTING PROVIDER's
 * returned line, a different question with no frontend consumer at all;
 * see that constant's own doc comment for why it stays a separate,
 * same-language duplicate. Also unrelated to
 * `routes/cruises/routeOverride.ts`'s `ROUTE_ANCHOR_TOLERANCE_KM` — a
 * different feature (cruise leg routes) that merely happens to share the
 * number.
 */
export const ANCHOR_TOLERANCE_KM = 1;
