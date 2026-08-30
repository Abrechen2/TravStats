import { api } from "./client";
import { logger } from "../logger";
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
  /** Present on the paginated list routes — see `listLodgings`. */
  meta?: { total: number; limit: number; offset: number };
}

// ---- Lodging CRUD ----

/** The server's own maximum per request (`lodgingQuerySchema`), so a full account costs as few round trips as the API allows. */
const LODGING_PAGE_SIZE = 500;
/** Backstop against an endless loop if `meta.total` ever disagrees with what the server actually returns. 20 000 lodgings is far past any real account. */
const MAX_LODGING_PAGES = 40;

/**
 * Every lodging matching the query — ALL of them, walked page by page.
 *
 * This used to be a single request with no `limit`, which the server answers
 * with its default page of 200 and a `meta.total` this client threw away. The
 * result was a list that stopped at 200 rows and said nothing: with 210
 * lodgings the same screen showed "210 Unterkünfte" in the stat strip (that
 * figure comes from /stats/lodging, which does not paginate) and "200
 * angezeigt" over a table missing ten alphabetically-last rows. Reported by a
 * tester as "the hotel I just created never appears in the list" — it sorted
 * past the cut, while its own detail page worked fine (Discord, 2026-08-09).
 *
 * Paging HERE rather than in the list page is deliberate: the dashboard map,
 * the domain stats and the settings membership picker call this same function,
 * and every one of them was silently losing the same rows. One fix, one code
 * path — a second "paged" entry point would have left them behind.
 */
export const listLodgings = async (params: LodgingListQuery = {}): Promise<Lodging[]> => {
  const items: Lodging[] = [];
  for (let page = 0; page < MAX_LODGING_PAGES; page += 1) {
    const { data } = await api.get<Envelope<Lodging[]>>("/lodging", {
      params: { ...params, limit: LODGING_PAGE_SIZE, offset: page * LODGING_PAGE_SIZE },
    });
    items.push(...data.data);
    // An empty page ends the walk even if `meta` is missing or wrong — without
    // it a stale `total` would spin this loop to its cap on every load.
    if (data.data.length === 0) return items;
    if (data.meta === undefined || items.length >= data.meta.total) return items;
  }
  logger.warn("listLodgings: stopped at the page cap — some lodgings were not fetched");
  return items;
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

// ------------------------------------------------------------- photographs

/** A photograph of the HOUSE — see backend `routes/lodging/photos.ts`. */
export interface LodgingPhoto {
  id: string;
  url: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: string;
}

export async function listLodgingPhotos(lodgingId: string): Promise<LodgingPhoto[]> {
  const res = await api.get<Envelope<LodgingPhoto[]>>(`/lodging/${lodgingId}/photos`);
  return res.data.data;
}

/**
 * Upload one or more photographs.
 *
 * The `Content-Type` override is REQUIRED, and this file first shipped without
 * it on the strength of a comment I wrote claiming the opposite. The shared
 * axios instance sets `application/json` for EVERY request; leaving it alone
 * sends a multipart body under a JSON header, multer parses no files, and the
 * route answers "No photos uploaded" — a 400 that reads like a server bug and
 * is entirely a client one. Naming `multipart/form-data` lets axios recognise
 * the FormData and fill in the boundary itself.
 *
 * The visit and trip uploaders carry the same line with the same note. Three
 * call sites, one trap, and it is only ever found by driving a browser.
 */
export async function uploadLodgingPhotos(
  lodgingId: string,
  files: readonly File[]
): Promise<LodgingPhoto[]> {
  const form = new FormData();
  for (const file of files) form.append("photos", file);
  const res = await api.post<Envelope<LodgingPhoto[]>>(`/lodging/${lodgingId}/photos`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.data;
}

export async function updateLodgingPhoto(
  lodgingId: string,
  photoId: string,
  input: { caption?: string | null; sortIdx?: number }
): Promise<LodgingPhoto> {
  const res = await api.patch<Envelope<LodgingPhoto>>(
    `/lodging/${lodgingId}/photos/${photoId}`,
    input
  );
  return res.data.data;
}

export async function deleteLodgingPhoto(lodgingId: string, photoId: string): Promise<void> {
  await api.delete(`/lodging/${lodgingId}/photos/${photoId}`);
}
