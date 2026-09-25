/**
 * Multi-domain registry — single source of truth for domain metadata.
 * See: docs/superpowers/specs/2026-04-19-multi-domain-foundation-design.md
 */

export const DOMAIN_KEYS = ["flight", "cruise", "lodging", "poi", "roadtrip", "rail"] as const;
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
  // Roadtrips (2.7, design 2026-09-24): several days on the road, stations
  // that sleep at the user's stays. Stored as `TripRoute` rows with
  // `kind = "roadtrip"` — a domain in the product sense (its own page, colour,
  // enable switch), the same engine as a tour underneath. No parser target.
  roadtrip: {
    key: "roadtrip",
    available: true,
    i18nKey: "domain.roadtrip",
    icon: "🚐",
    color: "#a597f0",
    routePrefix: "/roadtrips",
  },
  // Train journeys (spec 2026-09-25-rail-domain). Available, so shared code
  // iterating AVAILABLE_DOMAINS sees it; the UI additionally hides it behind
  // the `railDomain` beta gate. Brick red: clear of flight amber, cruise teal,
  // hotel mint, POI ink and the tour olive — see `domainColor.rail` in
  // design/tokens.json.
  rail: {
    key: "rail",
    available: true,
    i18nKey: "domain.rail",
    icon: "🚆",
    color: "#d4655c",
    routePrefix: "/rail",
  },
};

/**
 * Day tours are ONE colour (owner, 2026-09-05) — and since 2.7 a day tour is
 * all a tour is; the multi-day kind is the `roadtrip` domain above. The means of
 * transport changes the icon, never the hue — the web ran five colours for
 * train, hiking, cycling, road and ferry, and they fall with this constant.
 *
 * Not a member of `DOMAINS`: a tour is not a domain in the gating sense — it
 * has no `enabledDomains` entry, no route prefix of its own and no parser
 * target. It is a colour the map and the legend both need, and this is the one
 * place it is written. Mirrors `domainColor.tour` in `design/tokens.json` and
 * `--ts-domain-tour` in the generated theme.
 */
export const TOUR_COLOR = "#8faa5f";

export const AVAILABLE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter((k) => DOMAINS[k].available);

/**
 * Subset of domains that have a working parser (email + PDF + boarding
 * pass extraction). Strictly narrower than `AVAILABLE_DOMAINS` because
 * a domain can be live in the UI before a parser exists for it. Used
 * as the runtime allow-list for the `domain` field on every parse
 * endpoint — adding lodging parsing means adding `'lodging'` here once.
 */
export const PARSER_SUPPORTED_DOMAINS = [
  "flight",
  "cruise",
  "lodging",
] as const satisfies readonly DomainKey[];
export type ParserSupportedDomain = (typeof PARSER_SUPPORTED_DOMAINS)[number];

export function isValidDomain(value: string): value is DomainKey {
  return (DOMAIN_KEYS as readonly string[]).includes(value);
}

export function getDomainDescriptor(key: DomainKey): DomainDescriptor {
  if (!isValidDomain(key)) {
    throw new Error(`Unknown domain key: ${String(key)}`);
  }
  return DOMAINS[key];
}
