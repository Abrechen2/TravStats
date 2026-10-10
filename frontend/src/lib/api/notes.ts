import { API_URL, api } from "./client";
import type { LocalDateValue, TimeValue } from "../../shared/time";

/**
 * Standalone notes (forgejo#137) — a moment with no trip. Enveloped router
 * (`backend/src/routes/notes.ts`).
 */

export interface NotePhoto {
  /** Relative API URL; changes when the photo is replaced. */
  url: string;
  mimetype: string;
  sizeBytes: number;
}

/**
 * Who may read a note besides its owner (forgejo#146): `private` — nobody;
 * `shareable` — the other members of a shared trip on its days, and a public
 * trip link that offers notes.
 */
export type NoteVisibility = "private" | "shareable";

export interface Note {
  id: string;
  body: string;
  occurredAt: string;
  occurredZone: string;
  occurredPrecision: "minute" | "day";
  placeName: string | null;
  lat: number | null;
  lon: number | null;
  photo: NotePhoto | null;
  visibility: NoteVisibility;
  createdAt: string;
  updatedAt: string;
  times: { occurredAt: TimeValue; day: LocalDateValue };
}

/**
 * What the form sends for the moment: the wall clock and the zone it was
 * written in (ADR 0002 D3), or the bare day when no time was given.
 */
export type NoteMoment = { local: string; zone: string } | { day: string; zone: string };

export interface NoteWrite {
  body: string;
  moment: NoteMoment;
  placeName: string | null;
  visibility: NoteVisibility;
}

/** Another member's shareable note on a shared trip — read-only, no photo, no position. */
export interface MemberNote {
  id: string;
  author: { id: string; username: string; displayName: string };
  body: string;
  placeName: string | null;
  times: Note["times"];
}

/** The notes on a trip's days (`GET /notes/trip/:tripId`). */
export interface TripNotes {
  /** Null when the trip has no first or last day — no note can be placed then. */
  span: { start: LocalDateValue; end: LocalDateValue } | null;
  notes: Note[];
  memberNotes: MemberNote[];
  /** True when a list was cut at the server's bound. */
  truncated: boolean;
}

interface Envelope<T> {
  success: true;
  data: T;
}

interface ListEnvelope<T> extends Envelope<T> {
  meta: { total: number; limit: number; offset: number };
}

/** The request body for a moment — the one place that builds it. */
export function momentBody(moment: NoteMoment): {
  occurredAt: string | { local: string; zone: string };
  zone?: string;
} {
  return "day" in moment
    ? { occurredAt: moment.day, zone: moment.zone }
    : { occurredAt: { local: moment.local, zone: moment.zone } };
}

function writeBody(input: NoteWrite): Record<string, unknown> {
  return {
    body: input.body,
    placeName: input.placeName,
    visibility: input.visibility,
    ...momentBody(input.moment),
  };
}

/** Where the browser loads the photo from (cross-origin in dev, same-origin in production). */
export function notePhotoSrc(photo: NotePhoto): string {
  return API_URL ? `${API_URL}${photo.url}` : photo.url;
}

/** Notes per page of the timeline; older ones are loaded on request. */
export const NOTES_PAGE = 100;

export const notesApi = {
  /** One page, newest first, from `offset` in the server's order (occurredAt desc, id desc). */
  list: async (offset = 0, limit = NOTES_PAGE): Promise<{ notes: Note[]; total: number }> => {
    const { data } = await api.get<ListEnvelope<Note[]>>("/notes", {
      params: { limit, offset },
    });
    return { notes: data.data, total: data.meta.total };
  },

  /** The caller's notes on a trip's days, and the other members' shareable ones. */
  forTrip: async (tripId: string): Promise<TripNotes> => {
    const { data } = await api.get<Envelope<TripNotes>>(`/notes/trip/${tripId}`);
    return data.data;
  },

  create: async (input: NoteWrite): Promise<Note> => {
    const { data } = await api.post<Envelope<Note>>("/notes", writeBody(input));
    return data.data;
  },

  update: async (id: string, input: NoteWrite): Promise<Note> => {
    const { data } = await api.patch<Envelope<Note>>(`/notes/${id}`, writeBody(input));
    return data.data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/notes/${id}`);
  },

  /**
   * The shared client sends `application/json` on every request; a FormData
   * body needs the multipart type named, so axios recognises it and fills in
   * the boundary — under the JSON header multer reads no file at all.
   */
  setPhoto: async (id: string, file: File): Promise<Note> => {
    const form = new FormData();
    form.append("photo", file);
    const { data } = await api.put<Envelope<Note>>(`/notes/${id}/photo`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    });
    return data.data;
  },

  removePhoto: async (id: string): Promise<Note> => {
    const { data } = await api.delete<Envelope<Note>>(`/notes/${id}/photo`);
    return data.data;
  },
};
