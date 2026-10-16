import { prisma } from "../../db";
import type { Note } from "../../prisma";
import type { NoteVisibility } from "../../schemas/note";
import { localDay } from "../../shared/time/instant";
import { toDbDate } from "../../shared/time/localDate";
import type { LocalDateValue } from "../../shared/time/wire";
import { withdrawnTowards } from "../sharing/members";
import { PERSON_SELECT, toPerson, type SharePerson } from "../sharing/people";
import { tripTimes, type TripTimeColumns } from "../trips/timesDto";
import { toNoteDto, type NoteDto } from "./noteService";

/**
 * Notes on a trip's days (forgejo#146). A note belongs to no trip by a stored
 * link; it falls in a trip when its DAY — read in the zone it was written in,
 * `localDay(occurredAt, occurredZone)`, the same rule as `times.day` — lies in
 * the trip's first-to-last day.
 *
 * Visibility (`docs/superpowers/specs/2026-10-10-note-visibility.md`): the
 * owner reads all their notes here; another member of the trip's share group
 * reads only the owner's `shareable` ones, and only on days both trips cover.
 * A private note is never selected for anyone but its owner — the visibility
 * filter sits in the query, not in a later pass.
 */

/** Notes per trip and per reader — a trip is days, not years. */
export const TRIP_NOTES_MAX = 200;

const DAY_MS = 86_400_000;

export interface DaySpan {
  start: string;
  end: string;
}

/**
 * A trip's first and last day, or null when either is unknown or they are
 * out of order: a span the server cannot state places no note (abstention,
 * not a guess).
 */
export function tripDaySpan(trip: TripTimeColumns): DaySpan | null {
  const { start, end } = tripTimes(trip);
  if (!start || !end || start.date > end.date) return null;
  return { start: start.date, end: end.date };
}

function intersect(a: DaySpan, b: DaySpan): DaySpan | null {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
}

/**
 * One account's notes whose day lies in `span`, oldest first (`id` breaks
 * ties). The query is bounded by instants a day wider than the span on both
 * sides — every zone's day sits inside that — and `localDay` then decides
 * exactly. It reads page by page until `limit + 1` notes of the span are in
 * hand: bounding the wider read instead let notes from the margin fill the
 * page and be dropped, so a span with notes came back empty and "truncated".
 * `truncated` says notes of the span were left out.
 */
export async function notesInSpan(
  userId: string,
  span: DaySpan,
  options: { visibility?: NoteVisibility; limit?: number } = {}
): Promise<{ notes: Note[]; truncated: boolean }> {
  const limit = options.limit ?? TRIP_NOTES_MAX;
  const pageSize = limit + 1;
  const where = {
    userId,
    ...(options.visibility && { visibility: options.visibility }),
    occurredAt: {
      gte: new Date(toDbDate(span.start).getTime() - DAY_MS),
      lt: new Date(toDbDate(span.end).getTime() + 2 * DAY_MS),
    },
  };
  const inSpan: Note[] = [];
  let cursor: string | null = null;
  while (inSpan.length <= limit) {
    const page: Note[] = await prisma.note.findMany({
      where,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: pageSize,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    for (const note of page) {
      const day = localDay(note.occurredAt, note.occurredZone);
      if (day >= span.start && day <= span.end) inSpan.push(note);
    }
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return { notes: inSpan.slice(0, limit), truncated: inSpan.length > limit };
}

/** Another member's note as a trip member reads it: no position, no photo, no owner id. */
export interface MemberNoteDto {
  id: string;
  author: SharePerson;
  body: string;
  placeName: string | null;
  times: NoteDto["times"];
}

function toMemberNote(note: Note, author: SharePerson): MemberNoteDto {
  const { id, body, placeName, times } = toNoteDto(note);
  return { id, author, body, placeName, times };
}

const TRIP_SELECT = {
  id: true,
  userId: true,
  shareGroupId: true,
  startDate: true,
  endDate: true,
  startDay: true,
  endDay: true,
  startZone: true,
  endZone: true,
} as const;

/**
 * The other members' shareable notes for the caller's trip. A member counts
 * when their own trip is in the caller's trip's group and no consent between
 * the two was withdrawn (`withdrawnTowards` — propagation itself asks for
 * an ACCEPTED consent since 2026-10-16, `members.ts`); their
 * note's day must lie in their OWN trip of the group — the days they shared —
 * and in the caller's.
 */
async function memberNotes(
  callerId: string,
  groupId: string,
  callerSpan: DaySpan
): Promise<{ notes: MemberNoteDto[]; truncated: boolean }> {
  const trips = await prisma.trip.findMany({
    where: { shareGroupId: groupId, NOT: { userId: callerId } },
    select: { ...TRIP_SELECT, user: { select: PERSON_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  const blocked = await withdrawnTowards(
    prisma,
    callerId,
    trips.map((t) => t.userId)
  );
  const out: MemberNoteDto[] = [];
  let truncated = false;
  for (const trip of trips) {
    if (blocked.has(trip.userId)) continue;
    const own = tripDaySpan(trip);
    const span = own && intersect(own, callerSpan);
    if (!span) continue;
    const room = TRIP_NOTES_MAX - out.length;
    if (room <= 0) {
      truncated = true;
      break;
    }
    const found = await notesInSpan(trip.userId, span, { visibility: "shareable", limit: room });
    truncated ||= found.truncated;
    const author = toPerson(trip.user);
    out.push(...found.notes.map((note) => toMemberNote(note, author)));
  }
  out.sort((a, b) =>
    a.times.occurredAt.utc === b.times.occurredAt.utc
      ? a.id.localeCompare(b.id)
      : a.times.occurredAt.utc.localeCompare(b.times.occurredAt.utc)
  );
  return { notes: out, truncated };
}

export interface TripNotesDto {
  /** The days notes are matched against; null when the trip has no first or last day. */
  span: { start: LocalDateValue; end: LocalDateValue } | null;
  /** The caller's own notes on those days, private and shareable. */
  notes: NoteDto[];
  /** Shareable notes of the trip's other members (shared trips only). */
  memberNotes: MemberNoteDto[];
  /** True when a bound was reached: there may be notes on these days not listed. */
  truncated: boolean;
}

/** Null when the trip is not the caller's. */
export async function tripNotes(callerId: string, tripId: string): Promise<TripNotesDto | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: callerId },
    select: TRIP_SELECT,
  });
  if (!trip) return null;
  const span = tripDaySpan(trip);
  if (!span) return { span: null, notes: [], memberNotes: [], truncated: false };
  const times = tripTimes(trip);
  const own = await notesInSpan(callerId, span);
  const members = trip.shareGroupId
    ? await memberNotes(callerId, trip.shareGroupId, span)
    : { notes: [], truncated: false };
  return {
    span: { start: times.start as LocalDateValue, end: times.end as LocalDateValue },
    notes: own.notes.map(toNoteDto),
    memberNotes: members.notes,
    truncated: own.truncated || members.truncated,
  };
}
