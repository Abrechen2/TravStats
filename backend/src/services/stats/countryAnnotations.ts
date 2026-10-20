/**
 * What a passport row says beside its tier (forgejo#299): why a visit is
 * unclear, and which domain's records prove a visit in which years. Split out
 * of `passport.ts` (800-line limit); it reads the same evidence inputs the
 * fold read and decides nothing the fold decides.
 */
import { toCountryCode, type EvidenceInput, type EvidenceKind } from "../../shared/countryEvidence";
import type { DomainKey } from "../../shared/domains";
import type { VisitUnclearReason } from "./journeyEvidence";

/**
 * Why a ground-presence country may or may not have been visited — the
 * travel chain's own reasons (`./journeyEvidence.ts`). Train and coach
 * stations follow the same chain since the owner ruling of 2026-10-16, so the
 * former blanket `stationOnly` reason is gone.
 */
export type PassportUnclearReason = VisitUnclearReason;

/** One domain's share in a visited country; `VisitedCountrySource` minus the code. */
export interface CountryVisitSource {
  domain: DomainKey;
  years: number[];
  undated: boolean;
}

/** The overview's domain for each evidence kind. A track is no domain and proves nothing. */
const DOMAIN_OF_KIND: Record<EvidenceKind, DomainKey | null> = {
  flight: "flight",
  port: "cruise",
  place: "poi",
  lodging: "lodging",
  rail: "rail",
  bus: "bus",
  ferry: "ferry",
  roadtrip: "roadtrip",
  track: null,
  // The user's own word (forgejo#308) names no domain either.
  manual: null,
};

type AnnotatedInput = EvidenceInput & { unclear?: VisitUnclearReason };

const daysOf = (input: EvidenceInput): readonly string[] =>
  input.days ?? (input.at ? [input.at.toISOString().slice(0, 10)] : []);

export function countryAnnotations(inputs: readonly AnnotatedInput[]) {
  const byCode = new Map<string, AnnotatedInput[]>();
  for (const input of inputs) {
    const code = toCountryCode(input.country);
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), input]);
  }

  /** Sorted, distinct reasons why this country's visit cannot be decided. */
  const unclearReasons = (code: string): PassportUnclearReason[] => {
    const reasons = new Set<PassportUnclearReason>();
    for (const input of byCode.get(code) ?? []) {
      if (input.unclear) reasons.add(input.unclear);
    }
    return [...reasons].sort();
  };

  /**
   * The domains whose records PROVE the visit (a visit-grade tier), with
   * their years — so the overview's "Länder besucht" can be scoped by domain
   * chip and year and still apply the passport's rule. A home country lifted
   * to visited has no visit-grade record of its own; every record there then
   * stands for it, since living there is what made it a visit.
   */
  const visitSources = (code: string, liftedHome: boolean): CountryVisitSource[] => {
    const here = byCode.get(code) ?? [];
    const proving = liftedHome
      ? here
      : here.filter((i) => i.tier === "visited" || i.tier === "slept");
    const byDomain = new Map<DomainKey, { years: Set<number>; undated: boolean }>();
    for (const input of proving) {
      const domain = DOMAIN_OF_KIND[input.kind];
      if (!domain) continue;
      const acc = byDomain.get(domain) ?? { years: new Set<number>(), undated: false };
      const days = daysOf(input);
      if (days.length === 0) acc.undated = true;
      for (const day of days) acc.years.add(Number(day.slice(0, 4)));
      byDomain.set(domain, acc);
    }
    return [...byDomain]
      .map(([domain, acc]) => ({
        domain,
        years: [...acc.years].sort((a, b) => a - b),
        undated: acc.undated,
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  };

  return { unclearReasons, visitSources };
}
