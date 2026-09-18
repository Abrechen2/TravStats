import { z } from "./zod";
import {
  DOCUMENT_FORMATS,
  DOCUMENT_KINDS,
  ENTRY_TYPES,
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
});

export const documentUploadFieldsSchema = documentUploadFieldsObject.refine(
  (f) => (f.entryType === undefined) === (f.entryId === undefined),
  {
    message: "entryType and entryId go together",
  }
);

export const updateDocumentSchema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS).nullable().optional(),
    issuedOn: documentDateSchema.nullable().optional(),
    entry: entryRefSchema.nullable().optional(),
  })
  .strict();

/** Mirrors `toDocumentDto` in services/documents/documentService.ts. */
export const documentDtoSchema = z.object({
  id: uuid,
  format: z.enum(DOCUMENT_FORMATS),
  kind: z.enum(DOCUMENT_KINDS).nullable(),
  mimetype: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  originalName: z.string().nullable(),
  displayName: z.string(),
  issuedOn: z.string().nullable(),
  source: z.string(),
  parsedDomain: z.string().nullable(),
  entry: entryRefSchema.nullable(),
  createdAt: z.string(),
  linkedAt: z.string().nullable(),
  url: z.string(),
});

export const documentLimitsSchema = z.object(
  Object.fromEntries(DOCUMENT_FORMATS.map((f) => [f, z.number().int()])) as Record<
    (typeof DOCUMENT_FORMATS)[number],
    z.ZodNumber
  >
);
