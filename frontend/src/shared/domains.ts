/**
 * Frontend mirror of backend/src/shared/domains.ts.
 * Keep in sync manually — both source files are small and stable.
 */

export const DOMAIN_KEYS = [
  "flight",
  "cruise",
  "lodging",
  "poi",
  "roadtrip",
  "rail",
  "rental",
] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export interface DomainDescriptor {
  key: DomainKey;
  available: boolean;
  i18nKey: string;
  icon: string;
  color: string;
  routePrefix: string;
}

// Per-domain hexes are the DEFAULTS the user's override sits on top of
// (`hooks/useDomainColors.ts`), and since 2.7.0 they are the Companion's
// values — one colour per domain across web and phone (owner, 2026-09-05).
// Two hues moved: the web painted cruise in the Companion's `info` blue and
// lodging in a rose that exists nowhere else, while the Companion's mint was
// the web's POI colour. They now agree with `design/tokens.json → domainColor`
// and with `--ts-domain-*` in `theme/tokens.css`. Edits MUST stay in sync with
// the backend mirror at backend/src/shared/domains.ts.
export const DOMAINS: Record<DomainKey, DomainDescriptor> = {
  flight: {
    key: "flight",
    available: true,
    i18nKey: "domain.flight",
    icon: "✈",
    color: "#f0a947",
    routePrefix: "/flights",
  },
  cruise: {
    key: "cruise",
    available: true,
    i18nKey: "domain.cruise",
    icon: "🚢",
    color: "#4aa6b0",
    routePrefix: "/cruises",
  },
  lodging: {
    key: "lodging",
    available: true,
    i18nKey: "domain.lodging",
    icon: "🏨",
    color: "#5ec2b2",
    routePrefix: "/lodging",
  },
  poi: {
    key: "poi",
    available: true,
    i18nKey: "domain.poi",
    icon: "📍",
    color: "#e7e3dc",
    routePrefix: "/places",
  },
  // Roadtrips (2.7, design 2026-09-24) — mirror of the backend descriptor.
  // Moss, the same hue as a day tour (round 29): roadtrip and tour are one
  // colour, "road" in the Companion; a tour line differs by stroke width.
  // The violet before it was the Companion's rail lavender to the digit.
  roadtrip: {
    key: "roadtrip",
    available: true,
    i18nKey: "domain.roadtrip",
    icon: "🚐",
    color: "#a9c46a",
    routePrefix: "/roadtrips",
  },
  // Train journeys (spec 2026-09-25-rail-domain). Available, so shared code
  // iterating AVAILABLE_DOMAINS sees it; the UI additionally hides it behind
  // the `railDomain` beta gate. Lavender since round 29 (owner, 2026-09-26):
  // the brick red before it sat beside `bad` #e65a4f, so a rail row next to a
  // cancelled flight read the same and a late train had no colour left to say
  // so — see `domainColor.rail` in design/tokens.json.
  rail: {
    key: "rail",
    available: true,
    i18nKey: "domain.rail",
    icon: "🚆",
    color: "#a597e8",
    routePrefix: "/rail",
  },
  // Car rentals (spec 2026-10-01-rental-domain-design). Behind the
  // `rentalDomain` beta gate in the UI. The colour is PROVISIONAL (owner,
  // 2026-10-01): the domain colour table belongs to the Companion / Claude
  // Design, who have not chosen yet — the spec's candidate dusty rose stands
  // in until they do (`domainColor.rental` in design/tokens.json).
  rental: {
    key: "rental",
    available: true,
    i18nKey: "domain.rental",
    icon: "🚗",
    color: "#d98cb3",
    routePrefix: "/rentals",
  },
};

/**
 * Tours are ONE domain with ONE colour (owner, 2026-09-05). The means of
 * transport changes the icon, never the hue — the web ran five colours for
 * train, hiking, cycling, road and ferry, and they fall with this constant.
 *
 * Not a member of `DOMAINS`: a tour is not a domain in the gating sense — it
 * has no `enabledDomains` entry, no route prefix of its own and no parser
 * target. It is a colour the map and the legend both need, and this is the one
 * place it is written. Mirrors `domainColor.tour` in `design/tokens.json` and
 * `--ts-domain-tour` in the generated theme. Since round 29 (2026-09-26) it
 * equals the roadtrip default — one "road" hue; the map tells a tour from a
 * roadtrip by its thinner line (`tourMapOverlay.tsx`).
 */
export const TOUR_COLOR = "#a9c46a";

/**
 * Defaults a domain has carried and no longer does. Frontend only — the
 * backend mirror has no browser storage to read. Used solely to read the old
 * `domainColors.v1` storage (`store/domainColorStore.ts`), which wrote the
 * WHOLE map on every change — so a user who moved one picker, or pressed
 * reset, also froze every other domain at the default of that day, and a
 * later default change never reached them.
 * A v1 value equal to one of these is that frozen default, not a choice.
 *
 * - cruise, lodging, poi: the 2.6.x set, replaced by the Companion's in 2.7.0.
 * - roadtrip violet, rail brick red: replaced by round 29 (forgejo#131).
 */
export const RETIRED_DOMAIN_DEFAULTS: Readonly<Partial<Record<DomainKey, readonly string[]>>> = {
  cruise: ["#6fa0d6"],
  lodging: ["#d4778f"],
  poi: ["#5ec2b2"],
  roadtrip: ["#a597f0"],
  rail: ["#d4655c"],
};

export const AVAILABLE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter((k) => DOMAINS[k].available);

export function isValidDomain(value: string): value is DomainKey {
  return (DOMAIN_KEYS as readonly string[]).includes(value);
}

/**
 * Domains that carry loyalty programmes (owner, 2026-09-25): hotel cards,
 * frequent-flyer cards and cruise-line clubs, all on one page — and rail
 * programmes such as BahnBonus (forgejo#132 item 23). The vocabulary of
 * `LoyaltyMembership.domain`; the database holds it too, with a CHECK
 * constraint (migrations `20260925230000_loyalty_memberships` and
 * `20260926210438_loyalty_rail_domain`), so a domain added here needs that
 * constraint widened in the same change.
 */
export const LOYALTY_DOMAINS = [
  "flight",
  "cruise",
  "lodging",
  "rail",
  "rental",
] as const satisfies readonly DomainKey[];
export type LoyaltyDomain = (typeof LOYALTY_DOMAINS)[number];
