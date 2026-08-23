/**
 * Frontend mirror of backend/src/shared/domains.ts.
 * Keep in sync manually — both source files are small and stable.
 */

export const DOMAIN_KEYS = ["flight", "cruise", "lodging", "poi"] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export interface DomainDescriptor {
  key: DomainKey;
  available: boolean;
  i18nKey: string;
  icon: string;
  color: string;
  routePrefix: string;
}

// Per-domain hexes mirror brand/BRAND.md §3 (TravStatsWeb canonical).
// Drives map route colors, legend swatches, and any future per-domain
// chart accent. Edits MUST stay in sync with the backend mirror at
// backend/src/shared/domains.ts and tokens.css `--domain-*` values.
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
    color: "#6fa0d6",
    routePrefix: "/cruises",
  },
  lodging: {
    key: "lodging",
    available: true,
    i18nKey: "domain.lodging",
    icon: "🏨",
    color: "#d4778f",
    routePrefix: "/lodging",
  },
  poi: {
    key: "poi",
    available: true,
    i18nKey: "domain.poi",
    icon: "📍",
    color: "#5ec2b2",
    routePrefix: "/places",
  },
};

export const AVAILABLE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter((k) => DOMAINS[k].available);

export function isValidDomain(value: string): value is DomainKey {
  return (DOMAIN_KEYS as readonly string[]).includes(value);
}
