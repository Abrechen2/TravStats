import type { LoyaltyMembership } from "../../types/loyalty";

/** The domains whose cards `LoyaltyCardForm` edits; hotel cards keep their own editor. */
export type CardDomain = "flight" | "cruise" | "rail" | "rental";

export type CoverageField = "airlineCodes" | "cruiseLines" | "railOperators";

/**
 * The coverage field of a card of `domain`, named as the server names it. A
 * rental card has none: it is stored and shown but covers nothing by itself
 * (the server's schema claims no field for it).
 */
export const coverageField = (domain: CardDomain): CoverageField | null =>
  domain === "rental"
    ? null
    : domain === "flight"
      ? "airlineCodes"
      : domain === "rail"
        ? "railOperators"
        : "cruiseLines";

/**
 * The coverage list a card of `domain` carries. `railOperators` may be absent
 * on a card served by an instance older than rail loyalty (forgejo#132 item 23).
 */
export const coverageOf = (domain: CardDomain, card: LoyaltyMembership): string[] => {
  const field = coverageField(domain);
  return field === null ? [] : (card[field] ?? []);
};
