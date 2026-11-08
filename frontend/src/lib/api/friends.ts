import { isAxiosError } from "axios";
import { api } from "./client";
import { comparisonFailureCode } from "./comparison";
import type { ConnectionSwitches } from "../../types/sharingRemote";
import type { LeaderboardScope } from "../comparison/types";
import type { Friend, FriendPlans, FriendsResponse, FriendTrips } from "../friends/types";

const BASE = "/friends";
type Envelope<T> = { success: true; data: T };

const seg = (key: string): string => encodeURIComponent(key);
async function get<T>(path: string): Promise<T> {
  return (await api.get<Envelope<T>>(`${BASE}${path}`)).data.data;
}
async function send<T>(method: "post" | "put" | "delete", path: string, body?: unknown) {
  return (await api.request<Envelope<T>>({ method, url: `${BASE}${path}`, data: body })).data.data;
}

export const friendsApi = {
  list: () => get<FriendsResponse>(""),
  /** Never says whether the person exists; the answer is a pending friend either way. */
  request: (username: string, origin: string | null, switches: ConnectionSwitches) =>
    send<Friend>("post", "", { username, origin, switches }),
  accept: (key: string, switches: ConnectionSwitches) =>
    send<Friend>("post", `/${seg(key)}/accept`, { switches }),
  decline: (key: string) => send<{ declined: true }>("post", `/${seg(key)}/decline`),
  setSwitches: (key: string, switches: ConnectionSwitches) =>
    send<Friend>("put", `/${seg(key)}/switches`, { switches }),
  setScope: (key: string, scope: LeaderboardScope) =>
    send<Friend>("put", `/${seg(key)}/scope`, { scope }),
  remove: (key: string) => send<{ removed: true }>("delete", `/${seg(key)}`),
  trips: (key: string) => get<FriendTrips>(`/${seg(key)}/trips`),
  plans: (key: string) => get<FriendPlans>(`/${seg(key)}/plans`),
};

/** Codes `/friends` can answer with; each has DE+EN copy in `comparison:error.*`. */
export const FRIENDS_CODES = [
  "FRIENDS_NOT_FOUND",
  "FRIENDS_CONNECTION_STATE",
  "FRIENDS_SELF",
  "FRIENDS_SCOPE_INVALID",
  "FRIENDS_FEDERATION_OFF",
  "FRIENDS_PEER_UNREACHABLE",
] as const;

/** The `comparison:error.*` key for a failed call: a `/friends` code, else the comparison mapper's. */
export function friendsErrorKey(error: unknown): string {
  const code = isAxiosError(error)
    ? (error.response?.data as { code?: unknown } | undefined)?.code
    : undefined;
  if (typeof code === "string" && (FRIENDS_CODES as readonly string[]).includes(code))
    return `error.${code}`;
  return `error.${comparisonFailureCode(error)}`;
}
