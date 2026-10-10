import { isValidZone, now, toLocal } from "../../shared/time";
import type { Note, NoteMoment } from "../../lib/api/notes";

/**
 * The note editor's form state and the rules that turn it into a request.
 * Pure, so the rules are tested without a browser.
 */
export interface NoteDraft {
  body: string;
  /** `YYYY-MM-DD` as typed. */
  date: string;
  /** `HH:mm`, or empty for a note dated to the day only. */
  time: string;
  zone: string;
  placeName: string;
}

/**
 * A new note: "now", read on the clock of `zone` — the zone the user is
 * writing in (the profile's, which the form shows and lets them change). Never
 * the browser's own clock reading: a laptop still on home time would file an
 * evening note under the wrong day.
 */
export function newNoteDraft(zone: string, at: Date = now()): NoteDraft {
  const local = isValidZone(zone) ? toLocal(at, zone).local : at.toISOString().slice(0, 19);
  return {
    body: "",
    date: local.slice(0, 10),
    time: local.slice(11, 16),
    zone,
    placeName: "",
  };
}

/** An existing note as the form shows it — from the server's own `local`, never re-derived. */
export function draftOfNote(note: Note): NoteDraft {
  const { local } = note.times.occurredAt;
  return {
    body: note.body,
    date: local.slice(0, 10),
    time: note.occurredPrecision === "day" ? "" : local.slice(11, 16),
    zone: note.occurredZone,
    placeName: note.placeName ?? "",
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** Why a draft cannot be sent yet, as translation keys per field. */
export interface DraftProblems {
  body?: string;
  date?: string;
  zone?: string;
}

export function draftProblems(draft: NoteDraft): DraftProblems {
  return {
    ...(draft.body.trim() === "" && { body: "notes:editor.bodyRequired" }),
    ...(!DATE.test(draft.date) && { date: "notes:editor.dateRequired" }),
    ...(!isValidZone(draft.zone) && { zone: "notes:errors.zoneMissing" }),
  };
}

/** The moment to send: the wall clock with its zone, or the day alone without a time. */
export function draftMoment(draft: NoteDraft): NoteMoment {
  return TIME.test(draft.time)
    ? { local: `${draft.date}T${draft.time}`, zone: draft.zone }
    : { day: draft.date, zone: draft.zone };
}

export function sameDraft(a: NoteDraft, b: NoteDraft): boolean {
  return (
    a.body === b.body &&
    a.date === b.date &&
    a.time === b.time &&
    a.zone === b.zone &&
    a.placeName === b.placeName
  );
}

/** Notes grouped under the day each belongs to (its `times.day`), newest day first. */
export function notesByDay(notes: readonly Note[]): Array<{ day: string; notes: Note[] }> {
  const groups = new Map<string, Note[]>();
  const sorted = [...notes].sort(serverOrder);
  for (const note of sorted) {
    const day = note.times.day.date;
    groups.set(day, [...(groups.get(day) ?? []), note]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayNotes]) => ({ day, notes: dayNotes }));
}

/** The server's order: newest first, `id` descending among equal instants. */
function serverOrder(a: Note, b: Note): number {
  return a.occurredAt === b.occurredAt
    ? b.id.localeCompare(a.id)
    : b.occurredAt.localeCompare(a.occurredAt);
}

/**
 * The timeline keeps ONE invariant: the loaded notes are exactly the first
 * `notes.length` notes of the server's order. The next page is then simply
 * `offset = notes.length` — no note skipped, none twice — however many notes
 * were written, edited or deleted in between.
 */

/** A fetched page joined to what is loaded; a note already there is not taken twice. */
export function appendPage(loaded: readonly Note[], page: readonly Note[]): Note[] {
  const known = new Set(loaded.map((n) => n.id));
  return [...loaded, ...page.filter((n) => !known.has(n.id))].sort(serverOrder);
}

/**
 * A saved note in the loaded list. While older notes are still on the server
 * (`complete` false), a note that now sorts behind the oldest loaded one is
 * left for the page that brings it — inserting it would break the prefix and
 * make the next page skip a note.
 */
export function mergeSaved(loaded: readonly Note[], saved: Note, complete: boolean): Note[] {
  const others = loaded.filter((n) => n.id !== saved.id);
  const oldest = others[others.length - 1];
  if (!complete && oldest && serverOrder(saved, oldest) > 0) return others;
  return [...others, saved].sort(serverOrder);
}
