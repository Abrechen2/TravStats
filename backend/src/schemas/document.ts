import { z } from "./zod";
import { PARSER_SUPPORTED_DOMAINS } from "../shared/domains";
import {
  DOCUMENT_FORMATS,
  DOCUMENT_KINDS,
  ENTRY_TYPES,
  RENTAL_DOCUMENT_CATEGORIES,
} from "../services/documents/documentFormats";

/**
 * The request and response shapes of `routes/documents.ts` (forgejo#116), in
 * one place so the router and the OpenAPI spec read the same definition.
 */

const uuid = z.string().uuid();

export const documentDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a calendar date");

/**
 * Spread into a parse route's body schema (forgejo#116, step 4): `retain` keeps
 * the input as a document, `documentId` parses one already kept.
 */
export const parseRetentionFields = {
  retain: z
    .boolean()
    .optional()
    .describe("Keep the input as a document; the answer carries its documentId"),
  documentId: z
    .string()
    .uuid()
    .optional()
    .describe("Parse a document already kept (POST /documents) instead of content in the body"),
};

/**
 * `documentIds` on the five create routes: documents uploaded before their entry
 * existed, filed with it in the same request. Read apart from the entry's own
 * schema, so the list can never reach a Prisma spread of that schema's output.
 */
export const documentIdsBodySchema = z.object({
  documentIds: z
    .array(z.string().uuid())
    .max(20)
    .optional()
    .describe("Kept documents (POST /documents) to file with the new entry"),
});

/** `GET /documents/:id/link-candidates?q=` — a text search over the whole account's entries. */
export const linkCandidatesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

/** `POST /documents/:id/file-with-new-entry` — file a document with what the user just created from it. */
export const fileWithNewEntryBodySchema = z.object({
  domain: z.enum(["flight", "cruise", "lodging", "rail", "rental"]),
  openedAt: z.string().datetime(),
});

export const entryRefSchema = z.object({ type: z.enum(ENTRY_TYPES), id: uuid });

/** Multipart text fields arrive as strings; an empty one means "not sent". */
const optionalField = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** The text fields of the multipart upload, before the cross-field rule. */
export const documentUploadFieldsObject = z.object({
  clientDocumentId: optionalField(z.string().max(100)),
  entryType: optionalField(z.enum(ENTRY_TYPES)),
  entryId: optionalField(uuid),
  format: optionalField(z.enum(DOCUMENT_FORMATS)),
  displayName: optionalField(z.string().max(255)),
  source: optionalField(z.enum(["upload", "companion"])),
  kind: optionalField(z.enum(DOCUMENT_KINDS)),
  issuedOn: optionalField(documentDateSchema),
  rentalCategory: optionalField(z.enum(RENTAL_DOCUMENT_CATEGORIES)),
});

export const documentUploadFieldsSchema = documentUploadFieldsObject.refine(
  (f) => (f.entryType === undefined) === (f.entryId === undefined),
  {
    message: "entryType and entryId go together",
  }
);

export const updateDocumentSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("The name shown on screen (stored as the original name; the bytes keep theirs)"),
    kind: z.enum(DOCUMENT_KINDS).nullable().optional(),
    issuedOn: documentDateSchema.nullable().optional(),
    entry: entryRefSchema.nullable().optional(),
    rentalCategory: z.enum(RENTAL_DOCUMENT_CATEGORIES).nullable().optional(),
  })
  .strict();

/** The cost-block values of a parser reading — `ExtractedValues` in services/documents/documentValues.ts. */
export const extractedValuesSchema = z.object({
  price: z.number().nullable(),
  currency: z.string().nullable().describe("ISO 4217"),
  bookingReference: z.string().nullable(),
  seatNumber: z.string().nullable().describe("Flights and rail: the seat of the entry's leg"),
  seatClass: z.enum(["economy", "premium_economy", "business", "first"]).nullable(),
  travelClass: z
    .enum(["first", "second", "sleeper", "couchette"])
    .nullable()
    .optional()
    .describe("Rail only, absent otherwise: the class the ticket states"),
  coach: z
    .string()
    .nullable()
    .optional()
    .describe("Rail only, absent otherwise: the coach of the entry's leg"),
});

/** Mirrors `toDocumentDto` in services/documents/documentService.ts. */
export const documentDtoSchema = z.object({
  id: uuid,
  format: z.enum(DOCUMENT_FORMATS),
  kind: z.enum(DOCUMENT_KINDS).nullable(),
  mimetype: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  pageCount: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe(
      "Pages of a PDF, counted from its bytes when it was kept. Null when unknown: every " +
        "non-PDF, a PDF whose page tree could not be read, and documents kept before 2.7. Never 0."
    ),
  originalName: z.string().nullable(),
  displayName: z.string(),
  issuedOn: z.string().nullable(),
  rentalCategory: z
    .enum(RENTAL_DOCUMENT_CATEGORIES)
    .nullable()
    .describe(
      "What a rental's evidence shows — pickup, return, damage, fuel, odometer (forgejo#239). " +
        "Null = uncategorised, and always null off a rental"
    ),
  source: z.string(),
  parsedDomain: z.string().nullable(),
  entry: entryRefSchema.nullable(),
  createdAt: z.string(),
  linkedAt: z.string().nullable(),
  url: z.string(),
  parsedValues: extractedValuesSchema
    .nullable()
    .describe(
      "The values the reading stored on this document holds, booking-wide: with several legs, " +
        "seat and class abstain (GET /documents/{id}/stored-values picks a leg). Null when the " +
        "document was never parsed, its reading has an unknown shape, or it holds none of them. " +
        "Read from the stored reading — no parser runs."
    ),
});

/** What an entry shows for a document linked to it (plan D2). */
export const entryInfoSchema = entryRefSchema.extend({
  label: z.string().describe("A short human label: route, hotel, trip name …"),
  parentId: z
    .string()
    .nullable()
    .describe(
      "The id of the page showing the entry: a stay's lodging, a visit's place, an expense's trip"
    ),
  tripId: z.string().nullable().describe("The trip the entry sits in, if any"),
});

export const evidenceFromSchema = entryRefSchema.extend({
  label: z.string(),
  parentId: z.string().nullable(),
});

/** The person a document is for on an entry (plan D7). */
export const documentPersonSchema = z.object({
  id: uuid,
  displayName: z.string(),
  source: z
    .enum(["user", "auto"])
    .nullable()
    .describe("auto: assigned from a parsed passenger name; user: picked by hand"),
});

/**
 * The fields a per-entry document list adds (plan D2), all optional so an
 * installed Companion that reads only the old fields is unaffected.
 */
export const entryDocumentFieldsSchema = z.object({
  linkRole: z
    .enum(["primary", "covers"])
    .optional()
    .describe(
      "The document's role at THIS entry: filed here (primary) or evidence for it (covers)"
    ),
  evidenceFrom: evidenceFromSchema
    .nullable()
    .optional()
    .describe(
      'For a covers document, the entry it was filed at ("Beleg aus …"); null when this entry is the primary'
    ),
  linkCount: z.number().int().optional().describe("How many entries the document is linked to"),
  forCompanion: documentPersonSchema
    .nullable()
    .optional()
    .describe(
      "Plan D7: the companion this document is for AT THIS ENTRY; null = the owner or the whole group"
    ),
  forSource: z
    .enum(["user", "auto"])
    .nullable()
    .optional()
    .describe(
      "How the person was set: auto (parsed name), user (picked, or kept on me); null = undecided"
    ),
  viaExpense: z
    .boolean()
    .optional()
    .describe(
      "True when the document reaches this entry only through an expense paid at it: nothing to unlink here"
    ),
});

export const entryDocumentDtoSchema = documentDtoSchema.extend(entryDocumentFieldsSchema.shape);

export const documentLinkViewSchema = z.object({
  id: uuid,
  role: z.enum(["primary", "covers"]),
  provenance: z.enum(["user", "parser", "suggestion", "legacy"]),
  rentalCategory: z.enum(RENTAL_DOCUMENT_CATEGORIES).nullable(),
  createdAt: z.string(),
  entry: entryInfoSchema,
  companion: documentPersonSchema.pick({ id: true, displayName: true }).nullable(),
  companionSource: z.enum(["user", "auto"]).nullable(),
});

/** `PUT /documents/:id/links/companion` — the person of the link to ONE entry; null = me / the group. */
export const assignLinkCompanionSchema = z
  .object({ entry: entryRefSchema, companionId: uuid.nullable() })
  .strict();

export const linkCompanionResultSchema = z.object({
  companionId: uuid.nullable(),
  companionSource: z.enum(["user", "auto"]).nullable(),
});

export const addDocumentLinksSchema = z
  .object({
    links: z
      .array(
        z.object({
          entry: entryRefSchema,
          role: z.enum(["primary", "covers"]).optional(),
          provenance: z.enum(["user", "parser", "suggestion", "legacy"]).optional(),
          rentalCategory: z.enum(RENTAL_DOCUMENT_CATEGORIES).nullable().optional(),
        })
      )
      .min(1)
      .max(100),
  })
  .strict();

export const removedLinkSchema = z.object({
  role: z.enum(["primary", "covers"]),
  provenance: z.enum(["user", "parser", "suggestion", "legacy"]),
  rentalCategory: z.enum(RENTAL_DOCUMENT_CATEGORIES).nullable(),
  entry: entryRefSchema,
});

export const linkCandidatesSchema = z.object({
  tripEntries: z.array(entryInfoSchema),
  otherEntries: z.array(entryInfoSchema),
});

export const tripCandidatesQuerySchema = z.object({
  entryType: z.enum(ENTRY_TYPES),
  entryId: uuid,
});

/**
 * An unfiled document, as `GET /documents/unfiled` lists it. The extra field is
 * the whole point of the endpoint: a document with no entry is deleted after
 * UNLINKED_TTL_DAYS, and until 2026-09-19 nothing told anybody that.
 */
export const unfiledDocumentDtoSchema = documentDtoSchema.extend({
  deletesAt: z
    .string()
    .nullable()
    .describe(
      "ISO instant at which the sweep will remove this document, measured from when it " +
        "became unfiled. Null only for a row that carries no such stamp, which the sweep " +
        "also leaves alone."
    ),
});

/**
 * The unfiled list AND the number of days it is about, in one answer.
 *
 * The copy on screen names that number ("otherwise they are deleted 30 days
 * after…"), and a number written into a locale file is a number that goes on
 * saying 30 after someone changes `UNLINKED_TTL_DAYS`. There is one source of
 * truth for it, and this is how it reaches the browser.
 */
export const unfiledDocumentsResponseSchema = z.object({
  ttlDays: z
    .number()
    .int()
    .describe("Days an unfiled document is kept after it became unfiled (UNLINKED_TTL_DAYS)"),
  documents: z.array(unfiledDocumentDtoSchema),
});

/** `GET /documents` — one page of the caller's own documents. */
export const documentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(500),
  offset: z.coerce.number().int().min(0).default(0),
  companionId: uuid
    .optional()
    .describe("Only documents assigned to this companion on at least one entry (plan D7)"),
});

export const documentListResponseSchema = z.object({
  documents: z.array(
    documentDtoSchema.extend({
      linkCount: z
        .number()
        .int()
        .optional()
        .describe(
          "How many entries the document is linked to; a document counts once however many"
        ),
      people: z
        .array(documentPersonSchema.pick({ id: true, displayName: true }))
        .optional()
        .describe("The companions the document is assigned to on any entry (plan D7)"),
    })
  ),
  total: z.number().int().describe("Every document the caller owns, not just this page"),
});

export const documentLimitsSchema = z.object(
  Object.fromEntries(DOCUMENT_FORMATS.map((f) => [f, z.number().int()])) as Record<
    (typeof DOCUMENT_FORMATS)[number],
    z.ZodNumber
  >
);

/**
 * `POST /documents/:id/extract-values`. The domain is the entry's, sent by the
 * form — never guessed here, because a flight form must not be offered a
 * hotel's total. The two hints pick the leg out of a multi-flight booking.
 */
export const extractValuesBodySchema = z.object({
  domain: z.enum(PARSER_SUPPORTED_DOMAINS),
  flightNumber: z.string().trim().max(10).optional(),
  /** Rail: the train of the entry ("578" or "ICE 578"), to pick its leg. */
  trainNumber: z.string().trim().max(20).optional(),
  departureDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Leg hints for the reading already stored on a document (forgejo#132 item 3):
 * the extract-values body without its domain, which the stored reading names.
 */
export const storedValuesQuerySchema = extractValuesBodySchema.omit({ domain: true }).strict();
