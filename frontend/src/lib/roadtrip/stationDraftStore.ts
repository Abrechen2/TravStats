import { z } from "zod";

import { logger } from "../logger";
import { now } from "../../shared/time";
import type { EditorStation } from "./editorStation";

/**
 * The station editor's LOCAL draft (forgejo#244): what the reader changed and
 * the server has not confirmed yet, kept in this browser's localStorage.
 *
 * The editor saves as it goes. When that save cannot reach the server — a
 * train tunnel, a campsite's Wi-Fi — the edits used to live only in the
 * page's memory, and a reload or a closed tab lost them without a word. Now
 * every unsent change is also written here, and the next opening of the
 * roadtrip offers it back.
 *
 * Keyed by user AND roadtrip: a shared browser never offers one account's
 * stations to another, and two roadtrips never share a draft. The record
 * carries `base` — the station list as the server last confirmed it — beside
 * `drafts`, because restoring over a NEWER server state needs all three to
 * tell "I changed this" from "the server changed this" (`stationMerge.ts`).
 *
 * localStorage is external data: a hand-edited, truncated or older-format
 * record is dropped on read, never trusted.
 */

const PREFIX = "travstats:roadtrip-station-draft";

export interface StoredStationDraft {
  version: 1;
  /** When the draft was last written, as an instant (ISO). */
  savedAt: string;
  base: EditorStation[];
  drafts: EditorStation[];
}

const night = z.union([
  z.object({ kind: z.literal("stay"), lodgingStayId: z.string().nullable() }),
  z.object({ kind: z.literal("free") }),
  z.object({ kind: z.literal("pass"), placeId: z.string().nullish() }),
  z.object({ kind: z.literal("via") }),
]);

const station = z.object({
  key: z.string().min(1),
  id: z.string().optional(),
  title: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  notes: z.string().nullish(),
  night,
  stayLabel: z.string().optional(),
  stayCancelled: z.boolean().optional(),
  stayLodgingId: z.string().optional(),
  stayPlace: z.object({ lat: z.number().nullable(), lon: z.number().nullable() }).optional(),
  placeLabel: z.string().optional(),
});

const record = z.object({
  version: z.literal(1),
  savedAt: z.string(),
  base: z.array(station),
  drafts: z.array(station),
});

export function stationDraftKey(userId: string, routeId: string): string {
  return `${PREFIX}:${userId}:${routeId}`;
}

/**
 * Keep the draft. False when the browser refused (storage full, disabled,
 * private mode) — the editor then says the edits are NOT kept anywhere but
 * on the page, instead of claiming a safety it does not have.
 */
export function writeStationDraft(
  userId: string,
  routeId: string,
  draft: { base: EditorStation[]; drafts: EditorStation[] }
): boolean {
  const value: StoredStationDraft = {
    version: 1,
    savedAt: now().toISOString(),
    base: draft.base,
    drafts: draft.drafts,
  };
  try {
    window.localStorage.setItem(stationDraftKey(userId, routeId), JSON.stringify(value));
    return true;
  } catch (err) {
    logger.warn("Keeping the roadtrip station draft locally failed", err);
    return false;
  }
}

/** The kept draft, or null when there is none or it cannot be read. */
export function readStationDraft(userId: string, routeId: string): StoredStationDraft | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(stationDraftKey(userId, routeId));
  } catch (err) {
    logger.warn("Reading the roadtrip station draft failed", err);
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = record.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data as StoredStationDraft;
  } catch {
    // Not JSON at all — handled below like any other unreadable record.
  }
  logger.warn("Dropping an unreadable roadtrip station draft");
  clearStationDraft(userId, routeId);
  return null;
}

/**
 * Every station draft in this browser, of every user (review M5): called on a
 * deliberate logout, so a shared browser keeps nobody's unsent titles, notes
 * and coordinates — and drafts of roadtrips deleted meanwhile go with them.
 */
export function clearAllStationDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(`${PREFIX}:`)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch (err) {
    logger.warn("Removing the roadtrip station drafts failed", err);
  }
}

/** After a confirmed save, or when the reader discards the draft on purpose. */
export function clearStationDraft(userId: string, routeId: string): void {
  try {
    window.localStorage.removeItem(stationDraftKey(userId, routeId));
  } catch (err) {
    logger.warn("Removing the roadtrip station draft failed", err);
  }
}
