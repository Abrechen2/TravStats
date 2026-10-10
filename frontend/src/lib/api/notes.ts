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

export interface Note {
  id: string;
  clientId: string | null;
  body: string;
  occurredAt: string;
  occurredZone: string;
  occurredPrecision: "minute" | "day";
  placeName: string | null;
  lat: number | null;
  lon: number | null;
  photo: NotePhoto | null;
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
  return { body: input.body, placeName: input.placeName, ...momentBody(input.moment) };
}

/** Where the browser loads the photo from (cross-origin in dev, same-origin in production). */
export function notePhotoSrc(photo: NotePhoto): string {
  return API_URL ? `${API_URL}${photo.url}` : photo.url;
}

/** The newest notes first; one generous page — a diary is read, not paged through. */
export const NOTES_PAGE = 500;

export const notesApi = {
  list: async (): Promise<{ notes: Note[]; total: number }> => {
    const { data } = await api.get<ListEnvelope<Note[]>>("/notes", {
      params: { limit: NOTES_PAGE },
    });
    return { notes: data.data, total: data.meta.total };
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
