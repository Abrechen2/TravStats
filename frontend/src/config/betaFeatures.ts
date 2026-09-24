/**
 * Registry of everything hidden behind the instance-level beta gate.
 *
 * The gate itself is a single boolean on the AdminSettings row
 * (`betaFeaturesEnabled`), flipped by an admin via
 * `PUT /api/v1/admin/instance-settings` and read back — read-only — by every
 * logged-in user from `GET /api/v1/settings`. A fresh install has it OFF, which
 * is what makes this registry worth keeping.
 *
 * It is ON on the RC and Beta servers AND on the owner's own production
 * instance — measured on all three on 2026-09-09, and deliberate: the owner
 * runs his own instance with everything switched on. This file said "OFF on
 * production" until then, which had stopped being true on 2026-09-05 when a
 * dump from the RC carried the flag across.
 *
 * The consequence is worth stating once, because it is easy to be surprised by
 * it: putting a feature BACK behind this gate — as happened on 2026-09-05 with
 * tours, Companion pairing and Dawarich — changes nothing on an instance whose
 * flag is on. It protects everybody else's install, not the owner's.
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

/**
 * OWNER DECISION 2026-09-18: everything comes out of the registry EXCEPT the
 * phone app. `tripAiSummary`, `tourRoutes` and `dawarich` are released; the
 * one entry left is `devicePairing`, and it stays for the reason its own text
 * gives — the Companion is a TestFlight build, so offering a Devices section
 * to everybody would mint claim codes for an app they cannot install.
 *
 * That makes the 2.7 goal ("nothing left in the registry") a question about
 * the app, and nothing else.
 */
export const BETA_FEATURES = Object.freeze({
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
    why: "Pairing a phone works end to end; what is unfinished is the phone. Measured 2026-09-17: the Companion is version 0.1.0, build 23, handed out through TestFlight to one tester, and still gaining features daily. A Devices section offered to everybody would mint claim codes for an app they cannot install. The three came off the switch on 2026-09-01 on the strength of their own release conditions; on 2026-09-05, reading the 2.6.0 announcement, the owner ruled all three beta and put them back.",
    returnsWhen:
      "The Companion is installable outside TestFlight — a public build a reader of the release notes can actually get — and the owner accepts the pairing flow for release.",
    reason: "advanced",
  }),

  /**
   * The roadtrip domain and the reworked day tours (2.7, design
   * docs/superpowers/specs/2026-09-24-roadtrips-and-day-tours-design.md).
   *
   * Gated at ONE place: `useEnabledDomains` drops `roadtrip` while this is
   * closed, so the nav entry, the logbook tab, the dashboard tab, the
   * statistics tab and the overview all disappear together — each of them
   * already asks that hook. The settings and setup pickers ask the same key
   * so a domain nobody can see is not offered as a switch either.
   */
  roadtrips: Object.freeze({
    why: "Owner ruling 2026-09-24 in #dev-talk: the first version of roadtrips (a domain of its own, stations that sleep at the user's stays) and of day tours with climb and moving time goes into 2.7 behind the switch, so the 2.7 core can ship without waiting for it. The existing tour sections were classified by rule during the migration, and nobody has reviewed that classification on real data yet. The same evening the owner put tours as a whole back behind this key (they had been released on 2026-09-18): the tours page and editor, the tour tab on the dashboard and on a trip, the tours on the overview map, and the routing and Strava cards all ask `useToursVisible`, which reads this key.",
    returnsWhen:
      "The owner and the tester have used roadtrips on real trips, the automatic classification of existing sections has been reviewed on the RC's copy of production, and the owner accepts the domain for release.",
    reason: "beta",
  }),
  /**
   * "Complete from OpenStreetMap" on a lodging's page: stars, website, the
   * house's Wikidata item and a known chain, written only into empty fields.
   * Also needs the instance's open data switch; the button asks both.
   */
  lodgingEnrichment: Object.freeze({
    why: "Owner ruling 2026-09-24: the OpenStreetMap enrichment of hotels goes in behind the beta switch. It matches a house by its pin and its name within 150 m, and that match has not yet been checked against real lodgings — a wrong match would write a stranger's stars and website into the user's record.",
    returnsWhen:
      "The enrichment has been run over the owner's real lodgings on the RC's copy of production, its wrong matches counted and found acceptable, and the owner accepts it for release.",
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
