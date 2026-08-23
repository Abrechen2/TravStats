/**
 * Multi-domain registry — single source of truth for domain metadata.
 * See: docs/superpowers/specs/2026-04-19-multi-domain-foundation-design.md
 */

export const DOMAIN_KEYS = ['flight', 'cruise', 'lodging', 'poi'] as const;
export type DomainKey = typeof DOMAIN_KEYS[number];

export interface DomainDescriptor {
  key: DomainKey;
  available: boolean;
  i18nKey: string;
  icon: string;
  color: string;
  routePrefix: string;
}

// Per-domain hexes mirror brand/BRAND.md §3 (TravStatsWeb canonical).
// Edits MUST stay in sync with the frontend mirror at
// frontend/src/shared/domains.ts and tokens.css `--domain-*` values.
export const DOMAINS: Record<DomainKey, DomainDescriptor> = {
  flight: {
    key: 'flight',
    available: true,
    i18nKey: 'domain.flight',
    icon: '✈',
    color: '#f0a947',
    routePrefix: '/flights',
  },
  cruise: {
    key: 'cruise',
    available: true,
    i18nKey: 'domain.cruise',
    icon: '🚢',
    color: '#6fa0d6',
    routePrefix: '/cruises',
  },
  lodging: {
    key: 'lodging',
    available: true,
    i18nKey: 'domain.lodging',
    icon: '🏨',
    color: '#d4778f',
    routePrefix: '/lodging',
  },
  poi: {
    key: 'poi',
    available: true,
    i18nKey: 'domain.poi',
    icon: '📍',
    color: '#5ec2b2',
    routePrefix: '/places',
  },
};

export const AVAILABLE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter(
  (k) => DOMAINS[k].available,
);

/**
 * Subset of domains that have a working parser (email + PDF + boarding
 * pass extraction). Strictly narrower than `AVAILABLE_DOMAINS` because
 * a domain can be live in the UI before a parser exists for it. Used
 * as the runtime allow-list for the `domain` field on every parse
 * endpoint — adding lodging parsing means adding `'lodging'` here once.
 */
export const PARSER_SUPPORTED_DOMAINS = ['flight', 'cruise', 'lodging'] as const satisfies readonly DomainKey[];
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
