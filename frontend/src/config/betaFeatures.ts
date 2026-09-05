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
    why: "Until 2026-09-05 the summary ignored the admin's Ollama, wrote German for every reader, knew nothing about stays and places, and had no test — the 'buggy summaries' this gate named. Those are fixed on dev/v2.7; what remains is whether the text is GOOD, which only a reader can say.",
    returnsWhen:
      "The owner has read three summaries generated on the RC account — one German, one English, one for a trip with stays and place visits — and accepted them.",
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
    why: "Pairing a phone works end to end, but the Companion app and the flows behind it are unfinished. The three came off the switch on 2026-09-01 on the strength of their own release conditions; on 2026-09-05, reading the 2.6.0 announcement, the owner ruled all three beta and put them back. Off means the Devices section, the only place a claim code is minted, is not offered.",
    returnsWhen: "The owner accepts the Companion pairing for release.",
    reason: "advanced",
  }),

  /**
   * The Parser page — /parser and its admin-only nav entry: annotating a mail
   * to derive a template, the user's own templates, the community templates
   * and the parse log.
   *
   * READ THIS BEFORE REMOVING THE GATE: this gates the TEMPLATE WORKSHOP, not
   * the parsing. "Buchungs-E-Mail oder PDF" in the add dialog keeps reading
   * bookings whatever the flag says — that path is the product, this page is
   * the tooling behind it. The endpoints under /api/v1/templates stay open like
   * every other gated endpoint (see the file header).
   */
  parserTemplates: Object.freeze({
    reason: "beta",
    why: "Owner decision of 2026-09-05 (design-system decisions, no. 10): the page has carried a Beta badge since 2.2 with no gate behind it, and a badge nothing enforces is a promise nobody keeps. Only the LLM parser (Ollama) is fully tested; the template and regex parsers this page manages are experimental.",
    returnsWhen:
      "The template and regex parsers are tested against the sample set under test-samples/ and the owner accepts the page for release.",
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
    why: "The section list and its editor work end to end, but the feature is unfinished and may change. Released on 2026-09-01 on the owner's earlier acceptance; on 2026-09-05 the owner ruled it beta again, together with the Companion pairing and Dawarich, so the three move as one.",
    returnsWhen: "The owner accepts tours for release.",
    reason: "beta",
  }),

  /**
   * The Dawarich connection — a self-hosted location-history server TravStats
   * PULLS recorded tracks from, never writes to.
   *
   * It has its own key rather than riding on `tourRoutes`, even though tours
   * are its only consumer today. Dawarich is an integration, not a feature of
   * one domain: `dev/cruise-tracks` will take cruise legs from the same
   * connection, and a gate named after tours would then hide a card the cruise
   * feature needs. Gating an integration on one of its consumers is only ever
   * right while there is exactly one.
   */
  dawarich: Object.freeze({
    why: "The connection, the pull and the settings card work, but every consumer of a recorded track (tours) is beta again since 2026-09-05, so the connection that feeds it is too. Its own key on purpose: cruise legs will pull from the same connection.",
    returnsWhen: "Tours are released, or another consumer of recorded tracks ships.",
    reason: "beta",
  }),
} as const satisfies Readonly<Record<string, BetaFeatureMeta>>);

export type BetaFeatureKey = keyof typeof BETA_FEATURES;

export const BETA_FEATURE_KEYS = Object.freeze(
  Object.keys(BETA_FEATURES) as BetaFeatureKey[]
) as readonly BetaFeatureKey[];

export function isBetaFeatureKey(value: unknown): value is BetaFeatureKey {
  return typeof value === "string" && value in BETA_FEATURES;
}
