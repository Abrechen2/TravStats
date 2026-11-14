import { api } from "./client";

/**
 * "Einrichtung & Zustand": the stage 1 contract of
 * `docs/superpowers/specs/2026-11-14-setup-readiness-design.md` §11.
 *
 * Bare response family (ADR 0001, like settings): every read is `.data`, not
 * `.data.data`. The backend owns ids, revisions and evaluation; the copy lives
 * in the frontend's `readiness` namespace, named by `titleKey` and friends.
 */

export type ReadinessScope = "admin" | "user";
export type ReadinessSeverity = "required" | "recommended";
export type ReadinessStatus = "ready" | "needsAction" | "unknown";

export type ReadinessUserState = null | { kind: "snoozed"; until: string } | { kind: "optedOut" };

export interface ReadinessItem {
  id: string;
  revision: number;
  scope: ReadinessScope;
  severity: ReadinessSeverity;
  status: ReadinessStatus;
  /** ISO instant of the stored result; null where nothing was ever checked. */
  checkedAt: string | null;
  titleKey: string;
  consequenceKey: string;
  /** A settings address for `resolveAddress`; null for an item blocked by an admin item. */
  action: string | null;
  /** The admin item this one waits for. An ordinary account gets no detail beyond that fact. */
  blockedBy: string | null;
  optOutAllowed: boolean;
  userState: ReadinessUserState;
}

export type ReadinessNoteAction =
  null | { kind: "check"; checkId: string } | { kind: "address"; address: string };

export interface ReadinessNote {
  id: string;
  version: string;
  audience: ReadinessScope;
  beforeKey: string;
  afterKey: string;
  action: ReadinessNoteAction;
  /** Exactly one of `action` / `noActionReason` is non-null. */
  noActionReason: string | null;
  acknowledged: boolean;
  /** Check-backed: until the check is ready; otherwise until acknowledged. */
  open: boolean;
}

export interface ReadinessSummary {
  required: number;
  recommended: number;
  unknown: number;
  newNotes: number;
  blockedByAdmin: number;
  ready: number;
}

export interface ReadinessResponse {
  runningVersion: string;
  summary: ReadinessSummary;
  items: ReadinessItem[];
  notes: ReadinessNote[];
}

export async function fetchReadiness(): Promise<ReadinessResponse> {
  const { data } = await api.get<ReadinessResponse>("/readiness");
  return data;
}

const itemPath = (id: string): string => `/readiness/items/${encodeURIComponent(id)}`;

export async function snoozeReadinessItem(id: string, until?: string): Promise<void> {
  await api.post(`${itemPath(id)}/snooze`, until ? { until } : {});
}

export async function optOutReadinessItem(id: string): Promise<void> {
  await api.post(`${itemPath(id)}/opt-out`);
}

export async function clearReadinessItemState(id: string): Promise<void> {
  await api.delete(`${itemPath(id)}/state`);
}

export async function acknowledgeReadinessNote(id: string): Promise<void> {
  await api.post(`/readiness/notes/${encodeURIComponent(id)}/ack`);
}
