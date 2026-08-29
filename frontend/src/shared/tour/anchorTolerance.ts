/**
 * Frontend mirror of `backend/src/shared/tour/anchorTolerance.ts`. Keep
 * in sync manually — enforced by that file's own guard test
 * (`backend/src/shared/tour/__tests__/anchorTolerance.test.ts`), which
 * reads THIS file's source and fails if the two values diverge.
 *
 * See the backend file's doc comment for the full reasoning: the same
 * number decides whether the server will accept adopting a track onto a
 * leg AND whether this app's UI offers that option at all
 * (`frontend/src/lib/trackCoverage.ts`).
 */
export const ANCHOR_TOLERANCE_KM = 1;
