/**
 * Frontend mirror of backend/src/shared/domains.ts.
 * Keep in sync manually — both source files are small and stable.
 */

export const DOMAIN_KEYS = ["flight", "cruise", "hotel", "poi"] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export interface DomainDescriptor {
  key: DomainKey;
  available: boolean;
  i18nKey: string;
  icon: string;
  color: string;
  routePrefix: string;
}

export const DOMAINS: Record<DomainKey, DomainDescriptor> = {
  flight: {
    key: "flight",
    available: true,
    i18nKey: "domain.flight",
    icon: "✈",
    color: "#f472b6",
    routePrefix: "/flights",
  },
  cruise: {
    key: "cruise",
    available: true,
    i18nKey: "domain.cruise",
    icon: "🚢",
    color: "#38bdf8",
    routePrefix: "/cruises",
  },
  hotel: {
    key: "hotel",
    available: false,
    i18nKey: "domain.hotel",
    icon: "🏨",
    color: "#a855f7",
    routePrefix: "/hotels",
  },
  poi: {
    key: "poi",
    available: false,
    i18nKey: "domain.poi",
    icon: "📍",
    color: "#facc15",
    routePrefix: "/places",
  },
};

export const AVAILABLE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter((k) => DOMAINS[k].available);

export function isValidDomain(value: string): value is DomainKey {
  return (DOMAIN_KEYS as readonly string[]).includes(value);
}
