import { prisma } from "../../db";
import type { Note } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { CreateNoteInput, NoteVisibility, UpdateNoteInput } from "../../schemas/note";
import type { NoteTimes } from "../../schemas/times";
import { TzUnresolvedError } from "../../shared/time/errors";
import { localDay } from "../../shared/time/instant";
import { resolveTimeField, zoneOfCoordinates } from "../../shared/time/resolveInput";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import { serializeDay, serializeTime } from "../../shared/time/wire";
import { API_V1 } from "../files/privateFileUrls";
import type { ClaimClientRef } from "../sync/clientRef";

/**
 * Standalone notes (forgejo#137): the rules, apart from the HTTP translation in
 * `routes/notes.ts`.
 */

/** The caller-facing photo descriptor; the stored file name never leaves the server. */
export interface NotePhotoDto {
  /** Extension-less (forgejo#284), versioned so a replaced photo is not served from the browser cache. */
  url: string;
  mimetype: string;
  sizeBytes: number;
}

export type NoteDto = Omit<
  Note,
  "photoFilename" | "photoMimetype" | "photoSizeBytes" | "visibility"
> & {
  visibility: NoteVisibility;
  photo: NotePhotoDto | null;
  times: NoteTimes;
};

export function notePhotoUrl(note: Pick<Note, "id" | "updatedAt">): string {
  return `${API_V1}/notes/${note.id}/photo?v=${note.updatedAt.getTime()}`;
}

export function toNoteDto(note: Note): NoteDto {
  const { photoFilename, photoMimetype, photoSizeBytes, ...rest } = note;
  const precision = note.occurredPrecision === "day" ? "day" : "minute";
  return {
    ...rest,
    // A stored value outside the vocabulary reads as the safe one.
    visibility: note.visibility === "shareable" ? "shareable" : "private",
    photo:
      photoFilename && photoMimetype && photoSizeBytes !== null
        ? { url: notePhotoUrl(note), mimetype: photoMimetype, sizeBytes: photoSizeBytes }
        : null,
    times: {
      occurredAt: serializeTime(note.occurredAt, note.occurredZone, precision),
      day: serializeDay(localDay(note.occurredAt, note.occurredZone), note.occurredZone),
    },
  };
}

interface TimeColumns {
  occurredAt: Date;
  occurredZone: string;
  occurredPrecision: "minute" | "day";
}

/**
 * The stored moment of a note. The zone comes from `occurredAt` itself, else
 * the zone the client says it was written in, else the zone at the position.
 * With none of them the write is refused: a note's day depends on its zone,
 * and the server's, the profile's or UTC would be a guess (ADR 0002 D2).
 */
async function timeColumns(
  input: TimeFieldInput,
  zone: string | undefined,
  position: { lat: number | null; lon: number | null },
  userId: string,
  viaToken: boolean
): Promise<TimeColumns> {
  const resolved = await resolveTimeField(input, {
    field: "occurredAt",
    placeZone: () => zone ?? zoneOfCoordinates(position.lat, position.lon),
    userId,
    viaToken,
  });
  if (!resolved.zone) {
    throw new TzUnresolvedError("send `zone` (or a position) with the instant", "occurredAt");
  }
  return {
    occurredAt: resolved.utc,
    occurredZone: resolved.zone,
    occurredPrecision: resolved.precision === "day" ? "day" : "minute",
  };
}

export async function getOwnNote(userId: string, id: string): Promise<Note> {
  const note = await prisma.note.findFirst({ where: { id, userId } });
  if (!note) throw new AppError("Note not found", 404);
  return note;
}

export async function listNotes(
  userId: string,
  page: { limit: number; offset: number }
): Promise<{ notes: Note[]; total: number }> {
  const where = { userId };
  const [total, notes] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      // `id` breaks ties: two notes filed at the same minute must not swap
      // places — or appear twice — across a page boundary.
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: page.limit,
      skip: page.offset,
    }),
  ]);
  return { notes, total };
}

/**
 * Writes a note. The create claims the request's `clientRef` (forgejo#283,
 * `services/sync/clientRef.ts`) in the same transaction, so a repeat of the
 * same outbox write can never leave a second note behind.
 */
export async function createNote(
  userId: string,
  input: CreateNoteInput,
  viaToken: boolean,
  claim: ClaimClientRef
): Promise<Note> {
  const position = { lat: input.lat ?? null, lon: input.lon ?? null };
  const time = await timeColumns(input.occurredAt, input.zone, position, userId, viaToken);
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        userId,
        body: input.body,
        placeName: input.placeName ?? null,
        // Private unless the writer says otherwise (forgejo#146).
        visibility: input.visibility ?? "private",
        ...position,
        ...time,
      },
    });
    await claim(tx, note.id);
    return note;
  });
}

/**
 * A partial edit. The moment is re-read only when `occurredAt` is sent: moving
 * the position or renaming the place never shifts a note's time or its day.
 */
export async function updateNote(
  userId: string,
  id: string,
  input: UpdateNoteInput,
  viaToken: boolean
): Promise<Note> {
  const existing = await getOwnNote(userId, id);
  const position = {
    lat: input.lat !== undefined ? input.lat : existing.lat,
    lon: input.lon !== undefined ? input.lon : existing.lon,
  };
  const time = input.occurredAt
    ? await timeColumns(input.occurredAt, input.zone, position, userId, viaToken)
    : undefined;
  return prisma.note.update({
    where: { id: existing.id },
    data: {
      ...(input.body !== undefined && { body: input.body }),
      ...(input.placeName !== undefined && { placeName: input.placeName }),
      ...(input.lat !== undefined && { lat: input.lat }),
      ...(input.lon !== undefined && { lon: input.lon }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
      ...time,
    },
  });
}
