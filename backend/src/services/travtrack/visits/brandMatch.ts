/**
 * Does a stop's venue belong to a smart list's brand rule? (smart lists, spec
 * 2026-11-22-brand-lists.md.) Pure: the venue's OSM tags and the stop come in,
 * a verdict per rule goes out. Nothing here asks a service.
 *
 * What a match needs, every one of them:
 *  - the venue is the stop's top candidate (the chosen venue of the lookup) — a
 *    nearest-node guess never reaches here, so a drive-by is not a visit;
 *  - the venue is not disused / abandoned;
 *  - the dwell is inside the rule's window at BOTH ends (a four-hour stop beside a
 *    McDonald's is the hotel or the office);
 *  - the distance to the venue is within the rule's maximum.
 * By brand id (`brand:wikidata`) the match is `id`. A venue without that tag but with
 * an exactly equal `brand` string is a `name` match: weaker, never auto-accepted.
 * A venue that carries a DIFFERENT brand id never matches by name.
 */

import { type VenueBrand } from "../../dawarich/stays/venueBrand";

export { brandOfTags, type VenueBrand } from "../../dawarich/stays/venueBrand";

export type BrandRuleInput = {
  id: string;
  listId: string;
  listName: string;
  brandWikidataId: string;
  brandName: string;
  minDwellMinutes: number;
  maxDwellMinutes: number;
  maxDistanceM: number;
  autoAccept: boolean;
};

export type BrandMatch = {
  ruleId: string;
  listId: string;
  listName: string;
  brandWikidataId: string;
  brandName: string;
  strength: "id" | "name";
  /** Confident enough to be taken without asking: an id match on a list that allows it. */
  auto: boolean;
};

const norm = (v: string): string =>
  v
    .normalize("NFKC")
    .replace(/[’‘`´]/g, "'")
    .trim()
    .toLowerCase();

export function matchBrandRules(input: {
  rules: readonly BrandRuleInput[];
  venue: VenueBrand | null;
  topCandidate: boolean;
  dwellMinutes: number;
  distanceM: number;
}): BrandMatch[] {
  const { venue } = input;
  if (!venue || venue.disused || !input.topCandidate) return [];
  const out: BrandMatch[] = [];
  for (const rule of input.rules) {
    if (input.dwellMinutes < rule.minDwellMinutes || input.dwellMinutes > rule.maxDwellMinutes)
      continue;
    if (input.distanceM > rule.maxDistanceM) continue;
    let strength: "id" | "name" | null = null;
    if (venue.wikidata) strength = venue.wikidata === rule.brandWikidataId ? "id" : null;
    else if (venue.name && norm(venue.name) === norm(rule.brandName)) strength = "name";
    if (!strength) continue;
    out.push({
      ruleId: rule.id,
      listId: rule.listId,
      listName: rule.listName,
      brandWikidataId: rule.brandWikidataId,
      brandName: rule.brandName,
      strength,
      auto: strength === "id" && rule.autoAccept,
    });
  }
  return out;
}
