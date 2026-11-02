import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import axios from "axios";
import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";

/**
 * Plans on another server (spec 2026-11-02 §4): the member works on a plan whose host is another
 * TravStats server, through THIS server's `/remote-plans` API (enveloped). The plan screens call
 * the same `travplanApi` as for an own plan; while a remote plan is open, that API sends its
 * requests through `remotePlanHttp`, which rewrites the plan paths to `/remote-plans/<connection>/<plan>`
 * and unwraps the envelope, and refuses every path the host does not serve to a member.
 */
export type RemotePlanState = "invited" | "active";
export interface RemotePlanSummary {
  connectionId: string;
  origin: string;
  planId: string;
  /** The trip on the host; the plan screens address a plan by it. */
  tripId: string;
  title: string;
  ownerDisplayName: string;
  role: "editor";
  state: RemotePlanState;
}
export interface RemotePlanSource {
  connectionId: string;
  planId: string;
  tripId: string;
}
interface Envelope<T> {
  success: boolean;
  data: T;
}

/** Fired when the host or this server says the plan is no longer shared (403/404 with its code). */
export const REMOTE_PLAN_ENDED_EVENT = "travplan:remote-ended";
const ENDED_CODES = new Set(["REMOTE_PLAN_NOT_SHARED", "REMOTE_PLAN_NOT_FOUND"]);

let source: RemotePlanSource | null = null;
export const setRemotePlanSource = (next: RemotePlanSource | null): void => {
  source = next;
};
export const getRemotePlanSource = (): RemotePlanSource | null => source;
export const isRemotePlanMode = (): boolean => source !== null;

/** The plan's own address on the member's server, for links. */
export const remotePlanPath = (s: Pick<RemotePlanSummary, "connectionId" | "planId">): string =>
  `/plan/remote/${s.connectionId}/${s.planId}`;

const REMOTE_REST =
  /^(\/mutations|\/collab|\/notices\/read|\/documents|\/export|\/documents\/[0-9a-f-]{36}\/file)?$/;

/** `/trips/<trip>/plan[/rest]` mapped to the remote door; null for everything a member is not offered. */
export function mapRemotePath(url: string, current: RemotePlanSource): string | null {
  const own = `/trips/${current.tripId}/plan`;
  if (url !== own && !url.startsWith(own + "/")) return null;
  const rest = url.slice(own.length);
  if (!REMOTE_REST.test(rest)) return null;
  return `/remote-plans/${current.connectionId}/${current.planId}${rest}`;
}

export class RemotePlanRouteRefused extends Error {
  readonly code = "REMOTE_PLAN_ROUTE_REFUSED";
  constructor(url: string) {
    super("Not available for a plan on another server: " + url);
  }
}

const unwrap = <T>(res: AxiosResponse<T>): AxiosResponse<T> => {
  const body = res.data as unknown;
  if (
    res.status !== 304 &&
    body !== null &&
    typeof body === "object" &&
    (body as Envelope<T>).success === true &&
    "data" in (body as object)
  )
    return { ...res, data: (body as Envelope<T>).data };
  return res;
};

function notifyEnded(error: unknown): void {
  if (!axios.isAxiosError(error)) return;
  const code = (error.response?.data as { code?: string } | undefined)?.code;
  if (code && ENDED_CODES.has(code))
    window.dispatchEvent(new CustomEvent(REMOTE_PLAN_ENDED_EVENT, { detail: { code } }));
}

function target(url: string): string {
  const current = source;
  const mapped = current ? mapRemotePath(url, current) : null;
  if (!mapped) throw new RemotePlanRouteRefused(url);
  return mapped;
}
/** Through the host: slower than an own plan, so the cross-server timeout. */
const across = (config?: AxiosRequestConfig): AxiosRequestConfig => ({
  timeout: API_TIMEOUTS.REMOTE_SHARING,
  ...config,
});
async function call<T>(run: () => Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> {
  try {
    return unwrap(await run());
  } catch (error) {
    notifyEnded(error);
    throw error;
  }
}

/** The slice of an axios instance `travplanApi` uses, backed by the remote door. */
export const remotePlanHttp = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    call(() => api.get<T>(target(url), across(config))),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    call(() => api.post<T>(target(url), data, across(config))),
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    call(() => api.delete<T>(target(url), across(config))),
  patch: <T>(url: string): Promise<AxiosResponse<T>> =>
    Promise.reject(new RemotePlanRouteRefused(url)),
} as unknown as Pick<AxiosInstance, "get" | "post" | "delete" | "patch">;

const BASE = "/remote-plans";
const enc = encodeURIComponent;
const at = (s: { connectionId: string; planId: string }) =>
  `${BASE}/${enc(s.connectionId)}/${enc(s.planId)}`;

export const remotePlansApi = {
  list: async (): Promise<RemotePlanSummary[]> =>
    (await api.get<Envelope<RemotePlanSummary[]>>(BASE, across())).data.data,
  accept: async (s: { connectionId: string; planId: string }): Promise<RemotePlanSummary> =>
    (await api.post<Envelope<RemotePlanSummary>>(`${at(s)}/accept`, undefined, across())).data.data,
  decline: async (s: { connectionId: string; planId: string }): Promise<void> => {
    await api.post(`${at(s)}/decline`, undefined, across());
  },
  leave: async (s: { connectionId: string; planId: string }): Promise<void> => {
    await api.post(`${at(s)}/leave`, undefined, across());
  },
  /** The plan's trip as a `.travstats` file, scoped by the host to what a member may take. */
  exportTrip: async (s: {
    connectionId: string;
    planId: string;
  }): Promise<{ blob: Blob; filename: string }> => {
    const res = await api.get<Blob>(`${at(s)}/export`, {
      responseType: "blob",
      timeout: 5 * 60 * 1000,
    });
    const match = /filename="([^"]+)"/.exec(String(res.headers["content-disposition"] ?? ""));
    return { blob: res.data, filename: match?.[1] ?? "reise.travstats" };
  },
};
