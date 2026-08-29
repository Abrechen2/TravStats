/**
 * Registry of everything hidden behind the instance-level beta gate.
 *
 * The gate itself is a single boolean on the AdminSettings row
 * (`betaFeaturesEnabled`), flipped by an admin via
 * `PUT /api/v1/admin/instance-settings` and read back — read-only — by every
 * logged-in user from `GET /api/v1/settings`. It is ON on the RC/Beta servers
 * and OFF on production.
 *
 * Why a registry instead of scattered `if (betaEnabled)` checks: a bare
 * boolean sprinkled across the codebase decays. Six months from now nobody
 * remembers which call site guards what, why it was hidden, or what has to
 * happen before it can come back — so nothing is ever un-gated. Every gate
 * therefore names a key from this map, and a test asserts that every key used
 * in a gate exists here.
 *
 * IMPORTANT — this is a *visibility* gate, not a security boundary. The
 * backend endpoints behind these features (trip AI summary, `/pairing/*`)
 * remain reachable for any authenticated user whatever the flag says. That is
 * deliberate: hiding the Devices UI must not lock the owner out of pairing.
 *
 * To un-gate a feature: delete its entry here and the `isFeatureVisible` call
 * at its gate site. TypeScript will point at every place that needs touching.
 */

/** Why a feature is hidden. */
export type BetaFeatureReason =
  /** Unfinished or buggy — showing it would advertise something that isn't real. */
  | "beta"
  /** Works fine, but is useless / confusing for the average user right now. */
  | "advanced";

export interface BetaFeatureMeta {
  readonly reason: BetaFeatureReason;
  /** Why it is hidden today. */
  readonly why: string;
  /** The concrete condition under which this gate should be removed. */
  readonly returnsWhen: string;
  /** Tracking issue, if one exists. */
  readonly issue?: string;
}

export const BETA_FEATURES = Object.freeze({
  /** The LLM trip-summary card on the trip detail page. */
  tripAiSummary: Object.freeze({
    reason: "beta",
    why: "The generated summaries are buggy, and the whole Trips area is still unfinished — offering an AI summary sets an expectation the feature can't meet yet.",
    returnsWhen: "The Trips feature is complete.",
  }),

  /**
   * The "Devices" section in user settings (QR claim-code pairing flow).
   *
   * READ THIS BEFORE REMOVING THE GATE OR FORGETTING ABOUT IT: the Devices
   * page is the ONLY way to pair a phone. It starts the claim-code flow that
   * `backend/src/routes/pairing.ts` completes. With the gate OFF, nobody but
   * the instance owner can pair a device — and the owner only can because the
   * page is still reachable by URL (`/settings?section=devices`), which is a
   * hard requirement of this gate, not an accident. Do not "clean up" the
   * URL-reachability by dropping `devices` from the section model.
   */
  devicePairing: Object.freeze({
    reason: "advanced",
    why: "Pairing works, but it is pointless without the mobile app, which is not released. It is the only entry point to the QR claim-code flow, so it stays reachable at /settings?section=devices even while hidden from the nav.",
    returnsWhen: "The mobile app (TravStatsApp) is released.",
  }),

  /**
   * The whole Places (POI) domain — dashboard tab, /places list, nav entry,
   * the module toggle, and place visits on the trip timeline.
   *
   * This is NOT the old `poiDashboardTab` stub gate. The domain is real now:
   * Place + PlaceVisit, a migration off the old trip stops, an API, a map
   * layer and a list. What it is not yet is FINISHED — see `returnsWhen`.
   *
   * READ THIS BEFORE REMOVING THE GATE: hiding the domain must not orphan the
   * data. A user who created places on a beta instance and then upgrades to a
   * build with the flag off still owns those rows; they simply stop being
   * shown. Nothing here deletes or migrates anything, and the backend
   * endpoints stay reachable (this is a visibility gate — see the file header),
   * so a place visited on a trip keeps its `PlaceVisit` row and reappears
   * intact the moment the flag comes back on.
   */
  poiDomain: Object.freeze({
    reason: "beta",
    why: "The domain works end-to-end — create, edit, detail page, list, map — but is incomplete: there is no POI section in the map appearance panel, places are absent from the All tab, and neither custom lists (phase B) nor the shipped checklists (phase C) exist yet. The owner's own case, \"every McDonald's I have been to\", is exactly what custom lists are for and is the reason to keep this hidden.",
    returnsWhen: "Custom lists (phase B) have shipped.",
  }),

  /**
   * The "Touren" tab on the trip detail page (tour route sections: a named
   * ordered chain of stops with driven legs — the road-trip counterpart to
   * cruise itineraries), and its editor at
   * `/trips/:id/route/:routeId` — gated the same way as the tab, since the
   * editor is otherwise reachable by URL with the tab hidden.
   *
   * The list AND its editor (stop assignment, per-leg mode/source
   * overrides, the route map) are both feature-complete now. The gate stays
   * on because the feature as a whole is still awaiting the owner's release
   * decision, not because anything named here is unfinished.
   */
  tourRoutes: Object.freeze({
    reason: "beta",
    why: "The section list and its editor both work end-to-end, but the feature has not yet been through the owner's review — the gate is what keeps it off production until that happens.",
    returnsWhen: "The owner accepts the feature for release.",
  }),
} as const satisfies Readonly<Record<string, BetaFeatureMeta>>);

export type BetaFeatureKey = keyof typeof BETA_FEATURES;

export const BETA_FEATURE_KEYS = Object.freeze(
  Object.keys(BETA_FEATURES) as BetaFeatureKey[]
) as readonly BetaFeatureKey[];

export function isBetaFeatureKey(value: unknown): value is BetaFeatureKey {
  return typeof value === "string" && value in BETA_FEATURES;
}
