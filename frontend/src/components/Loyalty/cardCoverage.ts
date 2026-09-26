import type { LoyaltyMembership } from "../../types/loyalty";

/** The domains whose cards `LoyaltyCardForm` edits; hotel cards keep their own editor. */
export type CardDomain = "flight" | "cruise" | "rail";

/** The coverage field of a card of `domain`, named as the server names it. */
export const coverageField = (
  domain: CardDomain
): "airlineCodes" | "cruiseLines" | "railOperators" =>
  domain === "flight" ? "airlineCodes" : domain === "rail" ? "railOperators" : "cruiseLines";

/**
 * The coverage list a card of `domain` carries. `railOperators` may be absent
 * on a card served by an instance older than rail loyalty (forgejo#132 item 23).
 */
export const coverageOf = (domain: CardDomain, card: LoyaltyMembership): string[] =>
  card[coverageField(domain)] ?? [];
