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
 * IMPORTANT — this is mostly a *visibility* gate, not a security boundary.
 * Most backend endpoints behind these features (trip AI summary, `/pairing/*`)
 * remain reachable for any authenticated user whatever the flag says. That is
 * deliberate: hiding the Devices UI must not lock the owner out of pairing.
 * The exceptions are features a client keeps calling after nobody looks at the
 * page — the calendar feed, trip sharing across servers and TravPlan — whose
 * server refuses while the flag is off; each entry says so.
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
 * The entries below are the list — nothing else restates it, because a list in
 * prose beside a list in code is a list that goes wrong (this comment once
 * said "the one entry left is devicePairing" while six more had been added).
 * Each entry carries `why` it is hidden and `returnsWhen` it may come back;
 * the 2.7 goal is that the map is empty, and an entry leaves only on the
 * owner's word, never because its `returnsWhen` reads as met.
 */
export const BETA_FEATURES = Object.freeze({
  comparison: Object.freeze({
    reason: "beta",
    why: "The friend leaderboard was rebuilt on 2026-10-16 from server-side totals under per-person consent (spec docs/superpowers/specs/2026-10-16-comparison-rework-design.md). Across servers the totals travel signed but not end-to-end encrypted, by owner decision; that, and the load of ~9 loaders per friend, wants an RC look first (forgejo#40).",
    returnsWhen:
      "The owner accepts the rebuilt leaderboard on the RC — same-instance and one cross-server pair — and the leaderboard load is measured there.",
  }),
  encryptedShare: Object.freeze({
    reason: "beta",
    why: "The full-record, device-encrypted transfer (protocol v2, docs/FEDERATION_E2E.md) was split off the comparison page on 2026-10-16 and kept, unchanged, until the owner decides to keep or cut it. It has had no independent cryptographic review.",
    returnsWhen:
      "The owner decides to keep it AND an independent review of protocol v2 is done; if the owner cuts it, the entry goes with the code.",
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

  /**
   * Car rentals (spec 2026-10-01-rental-domain-design). Like every domain
   * switch here, gated through `config/domainBetaGates.ts`: this flag AND the
   * user's own domain choice.
   */
  rentalDomain: Object.freeze({
    why: "Car rentals (spec 2026-10-01-rental-domain-design) are built and have been in every 2.7.0 release candidate since rc.1; the Companion reads, imports and creates them too. What is missing is the owner's acceptance. Known gap: a rental document is read only by a template — Sixt's confirmation and invoice from the template repository, or one the user made in the workshop — and never by the AI model (by design: a parking booking looks the same), so any other provider is typed in by hand.",
    returnsWhen:
      "The owner explicitly takes rental out of beta. Packages being done is not that event.",
    reason: "beta",
  }),

  ferryDomain: Object.freeze({
    why: "Ferry crossings (forgejo#293) await acceptance with real tickets on RC.",
    returnsWhen: "The owner accepts ferry crossings for release after RC verification.",
    reason: "beta",
  }),
  busDomain: Object.freeze({
    why: "Long-distance coach rides (spec 2026-10-07-bus-domain-design) are built and have been in every release candidate since 2.7.0-rc.11; the Companion records and syncs them too. What is missing is the owner's acceptance. Known gap: a coach ticket is read only by a bus template from the workshop or the template repository, never by the AI model, so a ticket no template knows is typed in by hand.",
    returnsWhen:
      "The owner explicitly takes bus out of beta. Packages being done is not that event.",
    reason: "beta",
  }),

  /**
   * TravPlan, the planning mode for a trip that has not happened yet (`/plan*`).
   *
   * Gated in `hooks/useTravPlanVisible.ts` (nav entry, trip summary) and by
   * `BetaFeatureRouteGuard` on the `/plan*` routes (`pages/TravPlanRoute.tsx`).
   * The SERVER asks too (`services/travplan/availability.ts`): while the
   * switch is off every plan endpoint answers `PLAN_DISABLED` and
   * `/travplan/capabilities` says `enabled: false`. The instance's own
   * `travel_plan_config.enabled` is a second, server-side condition the hook
   * also asks — this key decides whether the mode exists at all.
   */
  travPlan: Object.freeze({
    why: "An alpha experiment (owner, 2026-10-16). The planning mode arrived on 2026-10-14 open to every logged-in user with no gate, drawn with its own theme and its own navigation outside the design system. It is unfinished: its screens were rebuilt on the primitives on 2026-10-16, and nobody has walked the planning flow in a browser since. The v2 route plan (stations, stages, routed legs) is in the server without any screen; most of its plan is not built yet.",
    returnsWhen:
      "The owner has walked the planning flow after the UI rework in a browser review and accepts it for release.",
    reason: "beta",
  }),

  /**
   * Recorded tracks on a cruise (2.7, board item `cruise-tracks`): a GPS
   * recording replaces a leg's computed sea route on the map and in the
   * statistics. Gated at ONE place, the "Aufgezeichnete Spuren" section of
   * `CruiseDetailPage`. The backend endpoints stay reachable, as for every
   * entry here; a cruise without recordings behaves exactly as before.
   */
  cruiseTracks: Object.freeze({
    why: "Built on 2026-09-25 without a browser acceptance (owner: none that night). Its three thresholds — a port counts as reached within 10 km, a step of more than 20 km between two points is a hole (raised to three times the recording's own median step for a sparse recording since 2026-09-26, after a 41-point GPX was read as all holes), and a leg whose holes exceed a quarter falls back to the sea route — were chosen from reasoning about tender ports and phones at sea, not measured on a real cruise recording. A wrong threshold would silently replace a sea route with a worse line and change the statistics.",
    returnsWhen:
      "The owner has added at least one real cruise recording (a Dawarich pull or a GPX export), checked the per-leg verdicts and the map against what was sailed, and accepts the feature for release.",
    reason: "beta",
  }),

  /**
   * A recorded flight track uploaded as a file (forgejo#312): GPX, KML, TCX or
   * FIT on the flight page, and the map drawing a recorded flight along its
   * recording instead of the great circle. Gated at two places: the upload,
   * replace and delete controls (and the flown-vs-great-circle line) of
   * `FlightTrackSection`, and the fetch of the recorded lines in
   * `useRecordedFlightPaths` — closed, the map draws every flight as before.
   * A recording the Companion sent stays visible on the flight page either way.
   */
  flightTrackUpload: Object.freeze({
    why: "Built on 2026-10-17 without a browser acceptance. The KML reader was written against the documented FlightAware and Flightradar24 export shapes, not against files exported from either service, and the map rule — a route keeps its arc while any flight on it has no recording — has not been looked at on a real logbook.",
    returnsWhen:
      "The owner has uploaded at least one real FlightAware or Flightradar24 export and one GPX logger file, checked the line on the flight page and on the globe and flat map, and accepts the feature for release.",
    reason: "beta",
  }),

  /**
   * The calendar subscription (forgejo#310): a secret `.ics` URL per user that
   * calendar apps poll. Gated in the "Reisen" settings section
   * (`SettingsSectionSwitch`), and on the SERVER as well — unlike most entries
   * here, `/api/v1/calendar/<token>.ics` answers 404 and no URL is issued while
   * the switch is off, because a subscription keeps polling long after anybody
   * looks at the page that hid it.
   */
  calendarFeed: Object.freeze({
    why: "Built on 2026-10-17 and tested against generated calendars only. Nobody has subscribed to a feed from Apple Calendar, Google Calendar or Outlook yet, and those clients differ in how they read all-day events, folding and refresh intervals; Google in particular polls on its own schedule from many addresses, which the per-feed rate limit has not met.",
    returnsWhen:
      "The owner has subscribed to the feed on the RC from at least Apple Calendar and Google Calendar, checked that flights, stays and rides land on the right days and hours, and accepts it for release.",
    reason: "beta",
  }),

  /**
   * Trip sharing across servers (forgejo#301, spec
   * docs/superpowers/specs/2026-10-20-federated-trip-sharing-design.md). Gated in two places:
   * the admin's switch in Admin → Instanz (`FederationSettings`) and the "people on other
   * servers" part of Settings → Reisen teilen (`RemoteSharingSection`). Like `calendarFeed` the
   * SERVER asks too: `/trip-share-peer` answers 404 and `/sharing/remote/*` refuses with
   * `SHARE_REMOTE_DISABLED` while the beta switch is off, because a peer would keep sending
   * long after anybody looks at the page that hid it.
   */
  federatedTripSharing: Object.freeze({
    why: "All five phases of the spec are built (F-S4a to F-S4e, spec §12): a trip is offered and copied to another server, kept in step both ways with conflicts shown, and can be left, revoked, paused after a restore or a new peer key and confirmed again, with a roster that asks before a newcomer's changes arrive. All of it has run only between in-process test servers; nothing has crossed between two real servers, and O2 to O10 are still working assumptions.",
    returnsWhen:
      "The owner has shared a trip between two real servers on the RC (both directions, an edit on each side, a leave or a revoke, a restore or re-pin confirmed again) and accepts it for release (spec O10).",
    issue: "forgejo#301",
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
