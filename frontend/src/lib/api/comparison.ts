import { isAxiosError } from "axios";
import { api } from "./client";
import { API_TIMEOUTS } from "../../config/constants";
import type {
  BoardView,
  LeaderboardResponse,
  LeaderboardScope,
  LeaderboardSnapshot,
  PeopleResponse,
  PersonView,
} from "../comparison/types";

const BASE = "/comparison";
type Envelope<T> = { success: true; data: T };

async function get<T>(path: string, params?: Record<string, string>, timeout?: number): Promise<T> {
  return (await api.get<Envelope<T>>(`${BASE}${path}`, { params, timeout })).data.data;
}
async function post<T>(path: string, body: unknown = {}): Promise<T> {
  return (await api.post<Envelope<T>>(`${BASE}${path}`, body)).data.data;
}
async function put<T>(path: string, body: unknown): Promise<T> {
  return (await api.put<Envelope<T>>(`${BASE}${path}`, body)).data.data;
}
async function del<T>(path: string): Promise<T> {
  return (await api.delete<Envelope<T>>(`${BASE}${path}`)).data.data;
}

export const comparisonApi = {
  /** Waits past the server's per-peer pull deadline, so a slow peer arrives as an `unreachable` row. */
  leaderboard: (year: number | null, board?: string) =>
    get<LeaderboardResponse>(
      "/leaderboard",
      { year: year === null ? "all" : String(year), ...(board ? { board } : {}) },
      API_TIMEOUTS.COMPARISON_LEADERBOARD
    ),
  preview: (scope: LeaderboardScope) => post<LeaderboardSnapshot>("/preview", scope),
  people: () => get<PeopleResponse>("/people"),
  request: (username: string, scope: LeaderboardScope) =>
    post<PersonView>("/requests", { username, scope }),
  accept: (consentId: string, scope: LeaderboardScope) =>
    post<PersonView>(`/consents/${consentId}/accept`, { scope }),
  decline: (consentId: string) => post<{ declined: true }>(`/consents/${consentId}/decline`),
  updateScope: (consentId: string, scope: LeaderboardScope) =>
    put<PersonView>(`/consents/${consentId}`, { scope }),
  end: (key: string) => del<{ ended: true }>(`/people/${encodeURIComponent(key)}`),
  createInvite: () => post<{ code: string; expiresAt: string }>("/invites"),
  claimInvite: (code: string, scope: LeaderboardScope) =>
    post<PersonView>("/invites/claim", { code, scope }),
  saveBoard: (input: { name: string; members: string[] }, id?: string) =>
    id ? put<BoardView>(`/boards/${id}`, input) : post<BoardView>("/boards", input),
  deleteBoard: (id: string) => del<{ deleted: true }>(`/boards/${id}`),
};

/** Every COMPARISON_* code the API can answer with; each has DE+EN copy in `comparison:error.*`. */
export const KNOWN_COMPARISON_CODES = [
  "COMPARISON_DISABLED",
  "COMPARISON_TOKEN_REFUSED",
  "COMPARISON_USER_NOT_FOUND",
  "COMPARISON_SELF",
  "COMPARISON_DUPLICATE",
  "COMPARISON_NOT_FOUND",
  "COMPARISON_NOT_PENDING",
  "COMPARISON_INVITE_INVALID",
  "COMPARISON_INVITE_LIMIT",
  "COMPARISON_FEDERATION_OFF",
  "COMPARISON_FEDERATION_ENV",
  "COMPARISON_PEER_UNKNOWN",
  "COMPARISON_PEER_UNREACHABLE",
  "COMPARISON_PEER_OUTDATED",
  "COMPARISON_PEER_KEY_INVALID",
  "COMPARISON_BOARD_NOT_FOUND",
  "COMPARISON_BOARD_MEMBER_INVALID",
  "COMPARISON_BOARD_LIMIT",
  "COMPARISON_REMOTE_LIMIT",
  "COMPARISON_YEAR_NOT_SHARED",
] as const;
export type ComparisonFailureCode =
  (typeof KNOWN_COMPARISON_CODES)[number] | "rateLimited" | "unknown";

export function comparisonFailureCode(error: unknown): ComparisonFailureCode {
  if (!isAxiosError(error)) return "unknown";
  // The throttle answers 429 with plain text and no code, so the status is the only signal.
  if (error.response?.status === 429) return "rateLimited";
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && (KNOWN_COMPARISON_CODES as readonly string[]).includes(code)
    ? (code as ComparisonFailureCode)
    : "unknown";
}
