/**
 * Kept originals (forgejo#116): the bill, the booking mail, the boarding pass
 * an entry was made from, stored as the original and filed with that entry.
 *
 * Every JSON answer is the `{ success, data }` envelope.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  documentDtoSchema,
  documentLimitsSchema,
  documentUploadFieldsObject,
  unfiledDocumentDtoSchema,
  updateDocumentSchema,
} from "../../../schemas/document";
import { ENTRY_TYPES, type EntryType } from "../../documents/documentFormats";

const documentDto = registry.register("Document", documentDtoSchema.openapi("Document"));
const unfiledDocumentDto = registry.register(
  "UnfiledDocument",
  unfiledDocumentDtoSchema.openapi("UnfiledDocument")
);
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const tags = ["Documents"];
const notFound = {
  description: "Not found — also for another user's document or entry",
  content: errorContent,
};
const badInput = { description: "Invalid input", content: errorContent };

registry.registerPath({
  method: "get",
  path: "/documents/limits",
  summary: "Size limits per document format, in bytes",
  description:
    "Also the capability probe: a server without kept originals answers 404 here, " +
    "which is how a client knows to hide the feature.",
  tags,
  responses: { 200: { description: "Limits", content: json(envelope(documentLimitsSchema)) } },
});

registry.registerPath({
  method: "get",
  path: "/documents/unfiled",
  summary: "Your uploads that are filed with nothing yet",
  description:
    "Ordered by when each became unfiled, newest first, bounded. Each carries `deletesAt`: an " +
    "unfiled document is removed — row and file — thirty days after it BECAME unfiled, not " +
    "after it was uploaded, so unfiling an old document gives it the full thirty days. The " +
    "endpoint exists so that deletion is announced before it happens; the inbox's review tab " +
    "lists these.",
  tags,
  responses: {
    200: {
      description: "Unfiled documents, newest first",
      content: json(envelope(z.array(unfiledDocumentDto))),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/documents",
  summary: "Keep an original, optionally filed with an entry",
  description:
    "multipart/form-data: the file in field `file`, plus the text fields below. The format is " +
    "decided from the bytes; a declared `format` the bytes contradict is refused (415). " +
    "Idempotent per file content and entry: sending the same file again answers 200 with the " +
    "document already on file, and an earlier unfiled copy is filed instead of stored twice. " +
    "`clientDocumentId` is accepted for the client's own bookkeeping; the content is the key.",
  tags,
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: documentUploadFieldsObject.extend({
            file: z.string().openapi({ format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Kept", content: json(envelope(documentDto)) },
    200: {
      description: "Already on file — the existing document",
      content: json(envelope(documentDto)),
    },
    400: badInput,
    404: notFound,
    413: { description: "Larger than the limit for its format", content: errorContent },
    415: { description: "Not an accepted format, or not the declared one", content: errorContent },
    429: { description: "Too many uploads this hour", content: errorContent },
  },
});

const ENTRY_LIST_PATHS: Record<EntryType, string> = {
  flight: "/flights/{id}/documents",
  cruise: "/cruises/{id}/documents",
  lodgingStay: "/lodging/stays/{id}/documents",
  placeVisit: "/places/visits/{id}/documents",
  trip: "/trips/{id}/documents",
};

for (const type of ENTRY_TYPES) {
  registry.registerPath({
    method: "get",
    path: ENTRY_LIST_PATHS[type],
    summary: `Documents filed with a ${type}`,
    tags,
    request: { params: idParams },
    responses: {
      200: {
        description: "Documents, oldest first",
        content: json(envelope(z.array(documentDto))),
      },
      404: notFound,
    },
  });
}

registry.registerPath({
  method: "get",
  path: "/documents/{id}",
  summary: "One document's description",
  tags,
  request: { params: idParams },
  responses: {
    200: { description: "The document", content: json(envelope(documentDto)) },
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/documents/{id}/file",
  summary: "The original's bytes",
  description:
    "Sets `Cache-Control: private`, overriding the API-wide `no-store`. Mail files and Wallet " +
    "passes are served as attachments rather than rendered.",
  tags,
  request: { params: idParams },
  responses: {
    200: {
      description: "The stored bytes",
      content: { "application/octet-stream": { schema: z.string() } },
    },
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/documents/{id}",
  summary: "Say what a document is, when it was issued, or file it",
  description:
    "`entry: null` takes it off its entry — it then expires after thirty days unless filed " +
    "again, and appears under `GET /documents/unfiled` with the exact date. " +
    "Moving a filed document to another entry is refused (409): unfile it first.",
  tags,
  request: { params: idParams, body: { content: json(updateDocumentSchema) } },
  responses: {
    200: { description: "Updated", content: json(envelope(documentDto)) },
    400: badInput,
    404: notFound,
    409: { description: "Filed with another entry", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/documents/{id}",
  summary: "Delete a document, row and file",
  tags,
  request: { params: idParams },
  responses: { 204: { description: "Deleted" }, 404: notFound },
});
