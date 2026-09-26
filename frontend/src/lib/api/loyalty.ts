import { api } from "./client";
import type { LoyaltyDomain } from "../../shared/domains";
import type {
  FrequentFlyerSuggestion,
  LoyaltyMembership,
  LoyaltyMembershipInput,
} from "../../types/loyalty";

interface Envelope<T> {
  success: boolean;
  data: T;
}

const BASE = "/loyalty-memberships";

export const listLoyaltyMemberships = async (): Promise<LoyaltyMembership[]> => {
  const { data } = await api.get<Envelope<LoyaltyMembership[]>>(BASE);
  return data.data;
};

/** One card without its activity — what a list filtered by it names it by. */
export const getLoyaltyMembership = async (id: string): Promise<LoyaltyMembership> => {
  const { data } = await api.get<Envelope<LoyaltyMembership>>(`${BASE}/${id}`);
  return data.data;
};

export const listFrequentFlyerSuggestions = async (): Promise<FrequentFlyerSuggestion[]> => {
  const { data } = await api.get<Envelope<FrequentFlyerSuggestion[]>>(`${BASE}/suggestions`);
  return data.data;
};

export const createLoyaltyMembership = async (
  domain: LoyaltyDomain,
  input: LoyaltyMembershipInput
): Promise<LoyaltyMembership> => {
  const { data } = await api.post<Envelope<LoyaltyMembership>>(BASE, { domain, ...input });
  return data.data;
};

export const updateLoyaltyMembership = async (
  id: string,
  input: LoyaltyMembershipInput
): Promise<LoyaltyMembership> => {
  const { data } = await api.patch<Envelope<LoyaltyMembership>>(`${BASE}/${id}`, input);
  return data.data;
};

export const deleteLoyaltyMembership = async (id: string): Promise<void> => {
  await api.delete(`${BASE}/${id}`);
};
