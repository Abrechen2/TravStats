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
   * The passport page — /passport, its nav entry, and GET /stats/passport.
   *
   * READ THIS BEFORE REMOVING THE GATE: the endpoint stays reachable while the
   * flag is off, as every gate here does (see the file header). That matters
   * more than usual: the Companion app is expected to READ this endpoint and
   * drop its own client-side derivation, and it must not have to care what an
   * instance's beta flag says.
   */
  passport: Object.freeze({
    reason: "beta",
    why: "The page is complete and the numbers agree with the statistics page, but it ships in the middle of a release candidate. Hiding it keeps 2.6.0's released surface unchanged while the RC still gets it in front of testers.",
    returnsWhen:
      "2.6.0 is promoted and the passport has had a round of real use — or 2.7.0 opens, whichever comes first.",
  }),

  /**
   * User-chosen colour per domain, applied to every surface outside the map.
   *
   * READ THIS BEFORE REMOVING THE GATE: the gate covers the VALUE, not just
   * the settings section — see `hooks/useDomainColors.ts`. With the flag off
   * everyone gets the brand set from BRAND.md §3, so an instance that turns
   * the flag back off does not keep rendering colours nobody can reach a
   * control for.
   *
   * The open question it is waiting on is not technical. BRAND.md §3 names the
   * four hexes as canonical and the backend mirrors the same table; letting a
   * user override them turns a brand constant into a default, which affects
   * screenshots, the wiki and the marketing site as much as the app.
   */
  domainColors: Object.freeze({
    reason: "advanced",
    why: "Overriding the four domain hues turns BRAND.md §3 from a constant into a default. That reaches past the app into screenshots, the wiki and travstats.de, so it is shown to beta instances first rather than to everyone at once.",
    returnsWhen:
      "The brand decision is settled: whether an instance may paint its own domain colours, and whether documentation screenshots are expected to match.",
    issue: "#270",
  }),

  /**
   * The whole Places (POI) domain — dashboard tab, /places list, nav entry,
   * the module toggle, and place visits on the trip timeline.
   *
   * This is NOT the old `poiDashboardTab` stub gate. The domain is real now:
   * Place + PlaceVisit, a migration off the old trip stops, an API, a map
   * layer and a list. What it is not yet is FINISHED — see `returnsWhen`.
   *
   * The three gaps this entry used to name are CLOSED (checked 2026-08-30):
   * the appearance panel has `map/PlaceAppearanceSection.tsx`, the All tab
   * loads places and place lists, and both custom lists (phase B) and the
   * curated checklists (phase C) ship. The `why` below was rewritten because a
   * gate whose stated reason has expired is worse than an unexplained one —
   * nobody re-reads a reason they have already accepted.
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
    why: "Places can only be added one at a time, by hand. There is no import route of any kind, so Settings → Import renders the POI group empty — `poiAdapter.tsx` still reads POI_IMPORT_READY = false and nothing references it. The picker compounds it: it writes no `externalRef`, so the @@unique([userId, externalRef]) index on Place never fires and the same place entered twice stays two rows. Offering a domain whose only way in is manual, and which cannot recognise its own duplicates, is what this gate is holding back.",
    returnsWhen:
      "Phase D lands an import route and the picker mints an identity — see docs/superpowers/specs/2026-08-25-poi-phase-d-import-design.md, §3.1 for the picker and §4 for the cheapest import. Custom lists (phase B), which this gate used to wait for, shipped.",
  }),
} as const satisfies Readonly<Record<string, BetaFeatureMeta>>);

export type BetaFeatureKey = keyof typeof BETA_FEATURES;

export const BETA_FEATURE_KEYS = Object.freeze(
  Object.keys(BETA_FEATURES) as BetaFeatureKey[]
) as readonly BetaFeatureKey[];

export function isBetaFeatureKey(value: unknown): value is BetaFeatureKey {
  return typeof value === "string" && value in BETA_FEATURES;
}
