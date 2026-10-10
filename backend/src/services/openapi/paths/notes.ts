/**
 * Standalone notes (forgejo#137) — a moment with no trip. Enveloped (ADR 0001).
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent, photoConversionUnavailable, photoUnreadable, timeRefused } from "./shared";
import {
  NOTE_PRECISIONS,
  createNoteSchema,
  noteQuerySchema,
  updateNoteSchema,
} from "../../../schemas/note";
import { noteTimesSchema } from "../../../schemas/times";
import { photoFileQuerySchema } from "../../../schemas/photoVariant";
import { clientRefBodySchema } from "../../../schemas/clientRef";
import { clientRefResponses } from "./clientRef";

const tags = ["Notes"];

const note = registry.register(
  "Note",
  z
    .object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      body: z.string(),
      occurredAt: z.string().datetime().describe("Real UTC instant the note is filed under"),
      occurredZone: z.string().describe("IANA zone it was written in, frozen at write time"),
      occurredPrecision: z.enum(NOTE_PRECISIONS),
      placeName: z.string().nullable().describe("Where it was written, as text — a snapshot"),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
      photo: z
        .object({
          url: z
            .string()
            .describe("Relative API URL of the bytes; changes when the photo is replaced"),
          mimetype: z.string(),
          sizeBytes: z.number().int(),
        })
        .nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
      times: noteTimesSchema,
    })
    .openapi("Note", {
      description:
        "A standalone note: a date, a body, optionally where it was written and a photo. " +
        "Belongs to no trip — which trip it falls in follows from `times.day`.",
    })
);

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });
const idParams = z.object({ id: z.string().uuid() });
const notFound = { description: "Not found, or not the caller's", content: errorContent };

registry.registerPath({
  method: "get",
  path: "/notes",
  summary: "List notes",
  description:
    "One page of the caller's notes, newest first (ties broken by id, so paging is stable).",
  tags,
  request: { query: noteQuerySchema },
  responses: {
    200: {
      description: "One page of notes",
      content: json(
        z.object({
          success: z.literal(true),
          data: z.array(note),
          meta: z.object({
            total: z.number().int(),
            limit: z.number().int(),
            offset: z.number().int(),
          }),
        })
      ),
    },
    400: { description: "Invalid query", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/notes/{id}",
  summary: "Get a note",
  tags,
  request: { params: idParams },
  responses: { 200: { description: "Note", content: json(envelope(note)) }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/notes",
  summary: "Write a note",
  description:
    "The zone of the moment is required in some form — inside `occurredAt`, as `zone`, or " +
    "through `lat`/`lon`; the server never falls back to its own, the profile's or UTC. " +
    "Takes the shared `clientRef` idempotency key (forgejo#283). The " +
    "photo is set afterwards with `PUT /notes/{id}/photo`.",
  tags,
  request: {
    body: {
      content: json(createNoteSchema.openapi("NoteCreateInput").and(clientRefBodySchema)),
    },
  },
  responses: {
    201: { description: "Written", content: json(envelope(note)) },
    ...clientRefResponses(json(envelope(note))),
    400: { description: "Validation failed", content: errorContent },
    422: timeRefused,
    429: { description: "Too many notes written", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/notes/{id}",
  summary: "Edit a note",
  description:
    "Partial. The moment is re-read only when `occurredAt` is sent; changing the place or " +
    "the position never moves the note's time or day.",
  tags,
  request: {
    params: idParams,
    body: { content: json(updateNoteSchema.openapi("NoteUpdateInput")) },
  },
  responses: {
    200: { description: "Updated", content: json(envelope(note)) },
    400: { description: "Validation failed", content: errorContent },
    404: notFound,
    422: timeRefused,
  },
});

registry.registerPath({
  method: "delete",
  path: "/notes/{id}",
  summary: "Delete a note and its photo",
  tags,
  request: { params: idParams },
  responses: { 204: { description: "Deleted" }, 404: notFound },
});

registry.registerPath({
  method: "put",
  path: "/notes/{id}/photo",
  summary: "Set or replace the note's photo",
  description:
    "multipart/form-data, one image in field `photo` (JPEG, PNG, WebP, GIF or HEIC/HEIF, up " +
    "to 15 MB). A replaced photo's file is removed. The shared demo account is refused.",
  tags,
  request: {
    params: idParams,
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({ photo: z.string().openapi({ format: "binary" }) }),
        },
      },
    },
  },
  responses: {
    200: { description: "The note with its photo", content: json(envelope(note)) },
    400: { description: "No photo, or not an image", content: errorContent },
    403: { description: "DEMO_ACCOUNT_FORBIDDEN", content: errorContent },
    404: notFound,
    413: { description: "Photo too large", content: errorContent },
    422: photoUnreadable,
    429: { description: "Too many uploads", content: errorContent },
    503: photoConversionUnavailable,
  },
});

registry.registerPath({
  method: "delete",
  path: "/notes/{id}/photo",
  summary: "Remove the note's photo",
  tags,
  request: { params: idParams },
  responses: {
    200: { description: "The note without a photo", content: json(envelope(note)) },
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/notes/{id}/photo",
  summary: "The note's photo",
  description:
    "`Cache-Control: private`. `variant=original` returns a HEIC as uploaded; the default is " +
    "what a browser can draw.",
  tags,
  request: {
    params: idParams,
    query: photoFileQuerySchema,
  },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: { description: "No such note, or it has no photo", content: errorContent },
  },
});
