import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";
import { staySuggestionsEnabled } from "../settings/suggestionSwitches";
import { inPrivacyZone } from "./classify";
import { privacyCircleSet } from "./privacyCircles";

/**
 * TravTrack's Aufenthalte tab (plan T5.3): the account's stays across their
 * states, read from the one store they already live in (`dawarich_stays`,
 * whose findings come from Dawarich or TravTrack — `provider`); nothing is
 * copied. Reviewing still happens through `/dawarich-stays/:id/accept|reject`.
 *
 *   - `pending` holds `accepting` too (a claim a crash left behind is still a
 *     question), and is empty while the account switched stay suggestions
 *     off — as in the inbox. Answered rows stay readable: they are history.
 *   - `covered` and `invalidated` are not listed: the first is already a
 *     logged visit, the second's history is gone.
 *   - `position` is null for a stay inside one of the account's privacy
 *     circles: the ordinary map never shows a zone, the stay row stays.
 *   - `day` is the stay's first day on its own zone's clock.
 *
 * Newest first, a page at a time: `nextCursor` while more remain.
 */

export const STAY_STATES = ["pending", "accepted", "rejected"] as const;
export type StayState = (typeof STAY_STATES)[number];

export type TravTrackStay = {
  id: string;
  status: StayState;
  provider: string;
  day: string;
  startAt: string;
  endAt: string;
  zone: string;
  position: { lat: number; lon: number } | null;
  name: string | null;
  place: { id: string; name: string } | null;
  tripId: string | null;
  visitId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
};

export type StayQuery = {
  states: readonly StayState[];
  from?: Date;
  to?: Date;
  cursor?: { startMs: number; id: string };
  limit: number;
};

const CURSOR = /^(\d{1,15}):([0-9a-f-]{36})$/;

export const formatStayCursor = (startMs: number, id: string) => `${startMs}:${id}`;
export function parseStayCursor(text: string | undefined): StayQuery["cursor"] {
  const m = text ? CURSOR.exec(text) : null;
  return m ? { startMs: Number(m[1]), id: m[2] } : undefined;
}

const dbStatuses = (states: readonly StayState[]) =>
  states.flatMap((s) => (s === "pending" ? ["pending", "accepting"] : [s]));

export async function travTrackStays(
  userId: string,
  q: StayQuery
): Promise<{ stays: TravTrackStay[]; nextCursor: string | null }> {
  const states =
    q.states.includes("pending") && !(await staySuggestionsEnabled(userId))
      ? q.states.filter((s) => s !== "pending")
      : q.states;
  if (states.length === 0) return { stays: [], nextCursor: null };
  const after = q.cursor
    ? {
        OR: [
          { startAt: { lt: new Date(q.cursor.startMs) } },
          { startAt: new Date(q.cursor.startMs), id: { lt: q.cursor.id } },
        ],
      }
    : {};
  const [rows, circlesAt] = await Promise.all([
    prisma.dawarichStay.findMany({
      where: {
        userId,
        status: { in: dbStatuses(states) },
        ...(q.to ? { startAt: { lt: q.to } } : {}),
        ...(q.from ? { endAt: { gte: q.from } } : {}),
        ...after,
      },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      select: {
        id: true,
        status: true,
        provider: true,
        startAt: true,
        endAt: true,
        zone: true,
        lat: true,
        lon: true,
        name: true,
        tripId: true,
        visitId: true,
        detectedAt: true,
        resolvedAt: true,
        place: { select: { id: true, name: true } },
      },
    }),
    privacyCircleSet(userId),
  ]);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    stays: page.map((r) => {
      const at = { lat: r.lat, lon: r.lon };
      return {
        id: r.id,
        status: (r.status === "accepting" ? "pending" : r.status) as StayState,
        provider: r.provider,
        day: localDay(r.startAt, r.zone),
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        zone: r.zone,
        position: inPrivacyZone(at, circlesAt(r.startAt.getTime())) ? null : at,
        name: r.name,
        place: r.place,
        tripId: r.tripId,
        visitId: r.visitId,
        detectedAt: r.detectedAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      };
    }),
    nextCursor:
      rows.length > q.limit && last ? formatStayCursor(last.startAt.getTime(), last.id) : null,
  };
}
