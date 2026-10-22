import { api } from "./client";

/**
 * Admin › Hotelketten (forgejo#321) — the lodging-chain catalogue,
 * `/admin/lodging-chains`. Failures carry a code in `error`.
 */

export interface CatalogueChain {
  id: number;
  name: string;
  brandColor: string | null;
  loyaltyProgram: string | null;
  isUserAdded: boolean;
  createdAt: string;
  /** Hotels of every account linked to this chain. */
  lodgingCount: number;
  /** Loyalty cards of every account that cover this chain. */
  membershipCount: number;
}

export interface ChainInput {
  name?: string;
  loyaltyProgram?: string | null;
  brandColor?: string | null;
}

export interface MergeResult {
  target: CatalogueChain;
  moved: { lodgings: number; memberships: number; newMembershipLinks: number };
}

export const CHAIN_ERROR_CODES = [
  "chainNameTaken",
  "chainInUse",
  "chainNotFound",
  "mergeIntoItself",
  "invalidInput",
] as const;

/** The i18n key for a refused request; anything else gets the generic line. */
export function chainErrorKey(err: unknown): string {
  const code = (err as { response?: { data?: { error?: unknown } } } | undefined)?.response?.data
    ?.error;
  return typeof code === "string" && (CHAIN_ERROR_CODES as readonly string[]).includes(code)
    ? `admin:lodgingChains.errors.${code}`
    : "admin:lodgingChains.errors.unknown";
}

export const adminLodgingChainsApi = {
  list: async (search: string): Promise<{ items: CatalogueChain[]; total: number }> => {
    const { data } = await api.get<{ items: CatalogueChain[]; total: number }>(
      "/admin/lodging-chains",
      { params: search.trim() ? { search: search.trim() } : {} }
    );
    return data;
  },
  create: async (input: ChainInput & { name: string }): Promise<CatalogueChain> => {
    const { data } = await api.post<CatalogueChain>("/admin/lodging-chains", input);
    return data;
  },
  update: async (id: number, input: ChainInput): Promise<CatalogueChain> => {
    const { data } = await api.patch<CatalogueChain>(`/admin/lodging-chains/${id}`, input);
    return data;
  },
  merge: async (id: number, targetId: number): Promise<MergeResult> => {
    const { data } = await api.post<MergeResult>(`/admin/lodging-chains/${id}/merge`, {
      targetId,
    });
    return data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/admin/lodging-chains/${id}`);
  },
};
