import {
  judgeCover,
  loadCoverContext,
  type CoverContext,
  type CoverTarget,
  type Covering,
} from "../../suggestions/covered";
import { reconcileStaySuggestions } from "../../suggestions/reconcile";

/**
 * "You already wrote this down" for GPS stays — since forgejo#439 a thin seam
 * over the shared matcher (`services/suggestions/covered.ts`), which photo
 * findings use too.
 *
 * History: on the owner's account (2026-10-16) 30 of 51 open stay findings sat
 * on a place visit logged live during the Korea trip. The first rule here
 * (250 m, a visit's clock within two hours) still left the Freiburg kind of
 * case open — a pin 331 m away, a visit earlier that day — and the photo scan
 * kept a rule of its own. One rule now decides for both.
 *
 * Only PLAIN stops are judged. A market or venue finding stands for the whole
 * site, and a visit to one shop inside it is not a visit to the market (the
 * market code keeps its own identity-based "already recorded" memory). The
 * callers hold that filter.
 *
 * A covered finding is never deleted: it is resolved as `covered`, and its
 * evidence names what covered it (`coveredBy`), so the inbox history can say
 * why it left and offer to take it back.
 */
export type CoverageContext = CoverContext;
export type StayToCover = CoverTarget;
export type StayCoverage = Covering;

/** The nearest record that already holds this stay, or null. Pure. */
export function coverageFor(stay: StayToCover, ctx: CoverageContext): StayCoverage | null {
  return judgeCover(stay, ctx).covered;
}

/** Every visit, lodging stay and flight that could cover a stay between `from` and `to`. */
export function loadCoverage(userId: string, from: Date, to: Date): Promise<CoverageContext> {
  return loadCoverContext(userId, from, to, { flights: true });
}

/**
 * Resolve every pending plain-stop finding a record now covers (and re-open a
 * covered one whose record is gone). Runs after each scan and before the
 * inbox reads its pending list. Returns how many were resolved.
 */
export async function resolveCoveredStays(userId: string): Promise<number> {
  return (await reconcileStaySuggestions(userId)).covered;
}
