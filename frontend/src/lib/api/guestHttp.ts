import axios, { type AxiosInstance } from "axios";
import { API_URL } from "./client";
import { API_TIMEOUTS } from "../../config/constants";

/**
 * Guest mode (forgejo#404, spec 2026-10-17 §6.5): a person from another server works on ONE plan
 * through the host's own web UI. They have no account here, so they talk to `/guest/plans/<id>`
 * with the `ts_guest` cookie and never to the user routes. The plan screens call the same
 * `travplanApi`; while guest mode is on, that API sends its requests through this instance, which
 * rewrites the plan paths to the guest door and refuses to reach anything else.
 *
 * A 401 here means "your access ended", never "log in": `api`'s 401 handler would clear a user
 * session that does not exist and send the guest to a login form that cannot help.
 */
export const GUEST_ENDED_EVENT = "travplan:guest-ended";
export const GUEST_MARKER_HEADER = "X-TravStats-Guest";

export interface GuestSession {
  planId: string;
  tripId: string;
}

let session: GuestSession | null = null;

export const setGuestSession = (next: GuestSession | null): void => {
  session = next;
};
export const getGuestSession = (): GuestSession | null => session;
export const isGuestMode = (): boolean => session !== null;

/** `/trips/<trip>/plan[/rest]` and the two search paths, mapped to the guest door; else null. */
export function guestPath(url: string, current: GuestSession): string | null {
  const base = "/guest/plans/" + current.planId;
  const own = "/trips/" + current.tripId + "/plan";
  if (url === own) return base;
  if (url.startsWith(own + "/")) return base + url.slice(own.length);
  if (url === "/travplan/locations") return base + "/locations";
  if (url === "/travplan/places") return base + "/places";
  return null;
}

export class GuestRouteRefused extends Error {
  readonly code = "PLAN_GUEST_ROUTE_REFUSED";
  constructor(url: string) {
    super("Not available to a guest: " + url);
  }
}

export const guestHttp: AxiosInstance = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : "/api/v1",
  headers: { "Content-Type": "application/json", [GUEST_MARKER_HEADER]: "1" },
  timeout: API_TIMEOUTS.DEFAULT,
  withCredentials: true,
});

guestHttp.interceptors.request.use((config) => {
  const current = session;
  if (!config.url) throw new GuestRouteRefused("");
  // Already a guest path (the session read, leaving) goes through as it is, even before the
  // plan is known: the session read is how it becomes known.
  if (config.url.startsWith("/guest/")) return config;
  if (!current) throw new GuestRouteRefused(config.url);
  const mapped = guestPath(config.url, current);
  if (!mapped) throw new GuestRouteRefused(config.url);
  config.url = mapped;
  return config;
});

guestHttp.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401)
      window.dispatchEvent(
        new CustomEvent(GUEST_ENDED_EVENT, { detail: { code: error.response.data?.code } })
      );
    return Promise.reject(error);
  }
);
