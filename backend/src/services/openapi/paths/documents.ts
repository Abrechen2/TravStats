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
  addDocumentLinksSchema,
  assignLinkCompanionSchema,
  linkCompanionResultSchema,
  documentDtoSchema,
  documentLinkViewSchema,
  entryDocumentDtoSchema,
  linkCandidatesSchema,
  removedLinkSchema,
  tripCandidatesQuerySchema,
  documentListQuerySchema,
  documentListResponseSchema,
  documentLimitsSchema,
  documentUploadFieldsObject,
  extractValuesBodySchema,
  extractedValuesSchema,
  storedValuesQuerySchema,
  unfiledDocumentDtoSchema,
  unfiledDocumentsResponseSchema,
  updateDocumentSchema,
} from "../../../schemas/document";
import {
  travellerFactsBodySchema,
  travellerRowSchema,
  travellersQuerySchema,
} from "../../../schemas/entryTravellers";
import { ENTRY_TYPES, type EntryType } from "../../documents/documentFormats";

const documentDto = registry.register("Document", documentDtoSchema.openapi("Document"));
const entryDocumentDto = registry.register(
  "EntryDocument",
  entryDocumentDtoSchema.openapi("EntryDocument")
);
registry.register("UnfiledDocument", unfiledDocumentDtoSchema.openapi("UnfiledDocument"));
const unfiledDocuments = registry.register(
  "UnfiledDocuments",
  unfiledDocumentsResponseSchema.openapi("UnfiledDocuments")
);
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const tags = ["Documents"];
const notFound = {
  description:
    "Not found — also for another user's document or entry. A missing entry carries " +
    "`code: DOCUMENT_ENTRY_NOT_FOUND`; a missing document has no code.",
  content: errorContent,
};
const badInput = { description: "Invalid input", content: errorContent };
/** Upload and PATCH also refuse a rental evidence category off a rental (forgejo#239). */
const badInputOrCategory = {
  description:
    "Invalid input; `DOCUMENT_CATEGORY_NOT_RENTAL` (`field: rentalCategory`) when a " +
    "`rentalCategory` is set on a document that is not filed with a rental",
  content: errorContent,
};

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
    "lists these. `ttlDays` is that thirty, sent rather than assumed, because the sentence on " +
    "screen names it.",
  tags,
  responses: {
    200: {
      description: "Unfiled documents, newest first, with the TTL they are subject to",
      content: json(envelope(unfiledDocuments)),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/documents",
  summary: "Every document you own, metadata only, paged",
  description:
    "Filed or not, oldest first. No file bytes — those are `GET /documents/{id}/file`. `total` " +
    "is the whole count, so a client walking `limit`/`offset` knows when it has all of them. " +
    "The spreadsheet export reads this.",
  tags,
  request: { query: documentListQuerySchema },
  responses: {
    200: {
      description: "One page of documents and the total",
      content: json(envelope(documentListResponseSchema)),
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
    400: badInputOrCategory,
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
  railJourney: "/rail/{id}/documents",
  rentalBooking: "/rentals/{id}/documents",
  busJourney: "/bus/{id}/documents",
  ferryJourney: "/ferry/{id}/documents",
  tripExpense: "/expenses/{id}/documents",
};

for (const type of ENTRY_TYPES) {
  registry.registerPath({
    method: "get",
    path: ENTRY_LIST_PATHS[type],
    summary: `Documents linked to a ${type}`,
    description:
      "Every document linked to the entry as `primary` (filed here) or `covers` (evidence for " +
      "it, filed at another entry), oldest first, each once. `linkRole`, `evidenceFrom` " +
      '("Beleg aus …": the entry a covers document is filed at) and `linkCount` are optional ' +
      "additions; the other fields keep their meaning, and `entry` stays the document's primary.",
    tags,
    request: { params: idParams },
    responses: {
      200: {
        description: "Documents, oldest first",
        content: json(envelope(z.array(entryDocumentDto))),
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
    "passes are served as attachments rather than rendered. `view=text` on a mail file " +
    "answers a plain-text reading of it instead — sender, recipients, date, subject, the body " +
    "(an HTML body reduced to its text) and the list of attachments, labelled in German " +
    "unless `Accept-Language` prefers English. Other formats ignore `view`.",
  tags,
  request: {
    params: idParams,
    query: z.object({ view: z.enum(["text"]).optional() }),
  },
  responses: {
    200: {
      description: "The stored bytes, or with `view=text` a mail's plain-text reading",
      content: {
        "application/octet-stream": { schema: z.string() },
        "text/plain": { schema: z.string() },
      },
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
    400: badInputOrCategory,
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

const extractedValues = extractedValuesSchema;

registry.registerPath({
  method: "post",
  path: "/documents/{id}/extract-values",
  summary: "Read price, currency and booking reference out of a kept document",
  description:
    "Runs the parser pipeline — with the caller's parser settings — on a kept PDF, .eml or " +
    "mail text and answers the values an entry's cost block holds, as a proposal: nothing is " +
    "written to any entry. For a flight, `flightNumber` and `departureDate` pick the leg out " +
    "of a multi-flight booking (for rail, `trainNumber` and `departureDate`); with several legs " +
    "and no match, seat and class abstain and the " +
    "booking-wide values are given only where every leg agrees. `values` is null when nothing " +
    "was found, with `reason` `noText` (no readable text, e.g. a scan) or `nothingFound`. The " +
    "reading is recorded on the document. Rate-limited by the PDF or the mail parse budget, " +
    "depending on the document's format; an image answers 415.",
  tags,
  request: {
    params: idParams,
    body: { content: json(extractValuesBodySchema), required: true },
  },
  responses: {
    200: {
      description: "The proposal",
      content: json(
        envelope(
          z.object({
            domain: z.enum(["flight", "cruise", "lodging"]),
            parserUsed: z.string().nullable(),
            values: extractedValues.nullable(),
            reason: z.enum(["noText", "nothingFound"]).nullable(),
          })
        )
      ),
    },
    400: badInput,
    404: notFound,
    415: { description: "A format the text parsers cannot read", content: errorContent },
    429: { description: "Parse budget spent", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/documents/{id}/stored-values",
  summary: "The values of the reading already stored on a document — no parser runs",
  description:
    "What POST /documents/{id}/extract-values would answer, read from the reading a parse " +
    "stored on the document instead of parsing again: no parse budget is spent and a read " +
    "token may ask (forgejo#132 item 3). The same leg hints pick the entry's leg. `values` is " +
    "null with `reason` `notParsed` (no stored reading), `unreadable` (a stored body of an " +
    "unknown shape — logged on the server) or `nothingFound`; `domain` is the one the stored " +
    "reading was parsed as, null without a usable reading.",
  tags,
  request: { params: idParams, query: storedValuesQuerySchema },
  responses: {
    200: {
      description: "The stored reading's values",
      content: json(
        envelope(
          z.object({
            domain: z.enum(["flight", "cruise", "lodging", "rail"]).nullable(),
            parserUsed: z.string().nullable(),
            values: extractedValues.nullable(),
            reason: z.enum(["notParsed", "unreadable", "nothingFound"]).nullable(),
          })
        )
      ),
    },
    400: badInput,
    404: notFound,
  },
});

const linkView = registry.register("DocumentLink", documentLinkViewSchema.openapi("DocumentLink"));
const duplicateOrGone = {
  description:
    "`DOCUMENT_LINK_EXISTS`: the entry already carries a link to this document (409); " +
    "all-or-none, nothing was written",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/documents/trip-candidates",
  summary: "Documents of an entry's own trip that it is not linked to yet",
  description:
    'What "Dokument aus der Reise verknüpfen" offers: documents linked to the trip the entry ' +
    "sits in, minus those already linked to the entry. Empty when the entry is in no trip.",
  tags,
  request: { query: tripCandidatesQuerySchema },
  responses: {
    200: {
      description: "Candidate documents, oldest first",
      content: json(envelope(z.array(documentDto))),
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/documents/{id}/links",
  summary: "Every entry a document is linked to",
  description:
    "Role (`primary` = filed there, `covers` = evidence for it), provenance and a label per " +
    "entry. The delete-everywhere dialog lists these before it asks.",
  tags,
  request: { params: idParams },
  responses: {
    200: { description: "The links", content: json(envelope(z.array(linkView))) },
    404: { description: "Not your document (`DOCUMENT_NOT_FOUND`)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/documents/{id}/link-candidates",
  summary: "Entries the document may still be linked to",
  description:
    "The account's own entries it is not linked to yet — those sharing a trip with one of its " +
    "links first — capped per type; a picker filters the rest by text.",
  tags,
  request: { params: idParams },
  responses: {
    200: { description: "Candidates", content: json(envelope(linkCandidatesSchema)) },
    404: { description: "Not your document (`DOCUMENT_NOT_FOUND`)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/documents/{id}/links",
  summary: "Also link a document to entries",
  description:
    "All or none. Links are `covers` unless the document has no primary yet; provenance is " +
    "`user`. A link never grants access: the document stays readable by its own account only. " +
    "Every entry must be the caller's (`DOCUMENT_ENTRY_NOT_FOUND`, 404, also for a gone entry).",
  tags,
  request: { params: idParams, body: { content: json(addDocumentLinksSchema) } },
  responses: {
    201: { description: "The document's links now", content: json(envelope(z.array(linkView))) },
    400: badInput,
    404: {
      description: "`DOCUMENT_NOT_FOUND` or `DOCUMENT_ENTRY_NOT_FOUND`",
      content: errorContent,
    },
    409: duplicateOrGone,
  },
});

registry.registerPath({
  method: "delete",
  path: "/documents/{id}/links",
  summary: "Remove a document from ONE entry",
  description:
    "`entryType` and `entryId` as query. Only that link goes; the document and its other " +
    "links stay. Removing the primary hands the role to the next link, or unfiles the " +
    "document with its thirty-day grace. The answer says what was removed, so it can be " +
    "put back with POST.",
  tags,
  request: { params: idParams, query: tripCandidatesQuerySchema },
  responses: {
    200: { description: "The removed link", content: json(envelope(removedLinkSchema)) },
    400: badInput,
    404: {
      description: "`DOCUMENT_NOT_FOUND` or `DOCUMENT_LINK_NOT_FOUND`",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/documents/{id}/links/companion",
  summary: "Who a document is for at ONE entry",
  description:
    "Plan D7. The person lives on the link: a boarding pass is one traveller's on the entry it " +
    "covers. `companionId: null` = the owner or the whole group. The result is `user` either " +
    "way, so a later parse never overrules the choice; a parse assigns only undecided links " +
    "(`auto`, from a passenger name matching exactly one person). The companion must be the " +
    "caller's own (`COMPANION_NOT_FOUND`); a link never grants access.",
  tags,
  request: { params: idParams, body: { content: json(assignLinkCompanionSchema) } },
  responses: {
    200: { description: "The link's person", content: json(envelope(linkCompanionResultSchema)) },
    400: badInput,
    404: {
      description: "`DOCUMENT_NOT_FOUND`, `DOCUMENT_LINK_NOT_FOUND` or `COMPANION_NOT_FOUND`",
      content: errorContent,
    },
  },
});

const travellerRow = registry.register(
  "EntryTraveller",
  travellerRowSchema.openapi("EntryTraveller")
);

registry.registerPath({
  method: "get",
  path: "/entry-travellers",
  summary: "The companions on an entry with their own facts and documents",
  description:
    "Plan D7. Seat, class, ticket number, booking reference and loyalty number per companion " +
    "(a cabin on a cruise, a driver flag on a rental; a stay only the last two). `facts` holds " +
    "the type's fields, null = not recorded; `factsSource` says whether a parse (`auto`) or the " +
    "user set them. The owner's own values stay on the entry. `documents` are those assigned " +
    "to the person on this entry.",
  tags,
  request: { query: travellersQuerySchema },
  responses: {
    200: {
      description: "Travellers, in the entry's order",
      content: json(envelope(z.array(travellerRow))),
    },
    400: { description: "Invalid input or `TRAVELLERS_UNSUPPORTED`", content: errorContent },
    404: { description: "Not your entry (`DOCUMENT_ENTRY_NOT_FOUND`)", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/entry-travellers/{companionId}",
  summary: "Set one companion's facts on an entry",
  description:
    "A patch: fields left out stay; null or an empty string clears one. Only the entry type's " +
    "own fields are accepted (`TRAVELLER_FACT_INVALID`). The companion must be on the entry " +
    "(`TRAVELLER_NOT_FOUND`) — facts never add a person to an entry.",
  tags,
  request: {
    params: z.object({ companionId: uuid }),
    body: { content: json(travellerFactsBodySchema) },
  },
  responses: {
    200: { description: "The traveller now", content: json(envelope(travellerRow)) },
    400: badInput,
    404: { description: "Not your entry, or the traveller is not on it", content: errorContent },
  },
});
