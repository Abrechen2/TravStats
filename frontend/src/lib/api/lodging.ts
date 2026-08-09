import { api } from "./client";
import type {
  Lodging,
  LodgingStay,
  LodgingChain,
  LodgingChainDetail,
  LodgingMembership,
  LodgingInput,
  StayInput,
  ChainInput,
  MembershipInput,
  LodgingListQuery,
  LodgingStats,
  FxPreview,
} from "../../types/lodging";

interface Envelope<T> {
  success: boolean;
  data: T;
}

// ---- Lodging CRUD ----

export const listLodgings = async (params: LodgingListQuery = {}): Promise<Lodging[]> => {
  const { data } = await api.get<Envelope<Lodging[]>>("/lodging", { params });
  return data.data;
};

export const getLodging = async (id: string): Promise<Lodging> => {
  const { data } = await api.get<Envelope<Lodging>>(`/lodging/${id}`);
  return data.data;
};

export const createLodging = async (input: LodgingInput): Promise<Lodging> => {
  const { data } = await api.post<Envelope<Lodging>>("/lodging", input);
  return data.data;
};

export const updateLodging = async (id: string, input: LodgingInput): Promise<Lodging> => {
  const { data } = await api.patch<Envelope<Lodging>>(`/lodging/${id}`, input);
  return data.data;
};

export const deleteLodging = async (id: string): Promise<void> => {
  await api.delete(`/lodging/${id}`);
};

// ---- Stay CRUD (nested under a lodging) ----

export const createStay = async (lodgingId: string, input: StayInput): Promise<LodgingStay> => {
  const { data } = await api.post<Envelope<LodgingStay>>(`/lodging/${lodgingId}/stays`, input);
  return data.data;
};

export const updateStay = async (
  lodgingId: string,
  stayId: string,
  input: StayInput,
): Promise<LodgingStay> => {
  const { data } = await api.patch<Envelope<LodgingStay>>(
    `/lodging/${lodgingId}/stays/${stayId}`,
    input,
  );
  return data.data;
};

export const deleteStay = async (lodgingId: string, stayId: string): Promise<void> => {
  await api.delete(`/lodging/${lodgingId}/stays/${stayId}`);
};

// ---- Chain catalog (shared across all users) ----

export const listChains = async (search?: string): Promise<LodgingChain[]> => {
  const params: Record<string, string> = {};
  if (search) params.search = search;
  const { data } = await api.get<Envelope<LodgingChain[]>>("/lodging-chains", { params });
  return data.data;
};

export const createChain = async (input: ChainInput): Promise<LodgingChain> => {
  const { data } = await api.post<Envelope<LodgingChain>>("/lodging-chains", input);
  return data.data;
};

export const getChainDetail = async (id: number): Promise<LodgingChainDetail> => {
  const { data } = await api.get<Envelope<LodgingChainDetail>>(`/lodging-chains/${id}`);
  return data.data;
};

// ---- Loyalty memberships (per-user, program-based — no chainId) ----

export const listMemberships = async (): Promise<LodgingMembership[]> => {
  const { data } = await api.get<Envelope<LodgingMembership[]>>("/lodging-memberships");
  return data.data;
};

export const createMembership = async (input: MembershipInput): Promise<LodgingMembership> => {
  const { data } = await api.post<Envelope<LodgingMembership>>("/lodging-memberships", input);
  return data.data;
};

export const updateMembership = async (
  id: string,
  input: MembershipInput,
): Promise<LodgingMembership> => {
  const { data } = await api.patch<Envelope<LodgingMembership>>(
    `/lodging-memberships/${id}`,
    input,
  );
  return data.data;
};

export const deleteMembership = async (id: string): Promise<void> => {
  await api.delete(`/lodging-memberships/${id}`);
};

// ---- FX preview (stay editor readout only — never the save-time snapshot) ----

export const getFxPreview = async (
  amount: number,
  from: string,
  date: string,
): Promise<FxPreview | null> => {
  const { data } = await api.get<Envelope<FxPreview | null>>("/lodging/fx-preview", {
    params: { amount, from, date },
  });
  return data.data;
};

// ---- Stats ----

export const getLodgingStats = async (): Promise<LodgingStats> => {
  const { data } = await api.get<Envelope<LodgingStats>>("/stats/lodging");
  return data.data;
};
