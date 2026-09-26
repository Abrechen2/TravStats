// Loyalty cards across domains — mirrors `backend/src/routes/loyaltyMemberships.ts`.
import type { LoyaltyDomain } from "../shared/domains";
import type { LodgingChainRef, LodgingRef } from "./lodging";

/**
 * What the card was used for, derived from the logbook by the counting rules
 * the statistics use. `nights` is null for flight cards and whenever no
 * counted item names its length; `lastActivity` null when none names a day.
 */
export interface MembershipActivity {
  count: number;
  nights: number | null;
  lastActivity: string | null;
  /**
   * The same per calendar year, newest first. An undated item counts in the
   * totals and in no year. Optional for fixtures written before it existed.
   */
  years?: Array<{ year: number; count: number; nights: number | null }>;
}

export interface LoyaltyMembership {
  id: string;
  userId: string;
  domain: LoyaltyDomain;
  programName: string;
  membershipNumber: string | null;
  /** The status held today, the only one a card keeps: there is no dated history. */
  tier: string | null;
  notes: string | null;
  /** Flight cards: IATA codes of the airlines the card covers. */
  airlineCodes: string[];
  /** Cruise cards: the cruise lines the card covers, as the cruises name them. */
  cruiseLines: string[];
  /** Hotel cards: chains and independent hotels, linked by id. */
  chainIds: number[];
  chains: LodgingChainRef[];
  lodgingIds: string[];
  lodgings: LodgingRef[];
  createdAt: string;
  updatedAt: string;
  /** Present on the list; absent on a create/update answer. */
  activity?: MembershipActivity | null;
}

export interface LoyaltyMembershipInput {
  programName?: string;
  membershipNumber?: string | null;
  tier?: string | null;
  notes?: string | null;
  airlineCodes?: string[];
  cruiseLines?: string[];
}

export interface FrequentFlyerSuggestion {
  membershipNumber: string;
  suggestedProgramName: string;
  airlines: Array<{ code: string | null; name: string }>;
  flightCount: number;
  lastUsed: string | null;
}
