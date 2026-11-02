import { z } from "zod";
import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * Plan documents (forgejo#404, spec 2026-10-17 §6.8, D6) for the members on this server. A member on
 * another server reaches the same documents through `/remote-plans/...` (`remotePlans.ts`).
 */
const uuid = z.string().uuid();
const json = (schema: z.ZodType) => ({ "application/json": { schema } });

const documentDto = z.object({
  id: uuid,
  displayName: z.string(),
  mimetype: z.string(),
  format: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string().datetime(),
  uploadedBy: z.object({ memberId: uuid, displayName: z.string() }).nullable(),
  bookingId: uuid.nullable(),
  attached: z.boolean(),
  url: z.string(),
});
const planDocuments = z.object({ documents: z.array(documentDto) });

type Method = "get" | "post" | "delete";
function reg(
  method: Method,
  path: string,
  description: string,
  success: z.ZodType,
  options: {
    status?: 200 | 201;
    body?: z.ZodType;
    params?: z.ZodRawShape;
    query?: z.ZodRawShape;
  } = {}
) {
  const params = options.params ? z.object(options.params) : undefined;
  registry.registerPath({
    method,
    path,
    tags: ["TravPlan"],
    description,
    security: [{ BearerAuth: [] }],
    request: {
      ...(params ? { params } : {}),
      ...(options.query ? { query: z.object(options.query) } : {}),
      ...(options.body ? { body: { content: json(options.body) } } : {}),
    },
    responses: {
      [options.status ?? 200]: { description: "Success", content: json(success) },
      400: { description: "Invalid input", content: errorContent },
      403: { description: "Owner-only act", content: errorContent },
      404: { description: "Not found, or not on this plan", content: errorContent },
      409: { description: "Conflict or limit", content: errorContent },
      429: { description: "Rate limit", content: errorContent },
    },
  });
}

const tripId = { tripId: uuid };

reg(
  "get",
  "/trips/{tripId}/plan/documents",
  "The documents of the plan the caller may see: the plan's booking documents and the ones members uploaded for the plan. A co-planner never sees the owner's other documents; the owner sees the whole trip.",
  planDocuments,
  { params: tripId }
);
reg(
  "post",
  "/trips/{tripId}/plan/documents",
  "Upload a document for the plan (multipart field `file`, optional `bookingId`). At most 20 MB and 50 documents per member. The same bytes as one of the owner's private documents are stored as a separate plan document, answered exactly like a new file.",
  documentDto,
  { status: 201, params: tripId, body: z.object({ bookingId: uuid.optional() }) }
);
reg(
  "get",
  "/trips/{tripId}/plan/documents/{documentId}/file",
  "The bytes of a document the caller may see, as an attachment. 404 PLAN_DOCUMENT_NOT_FOUND for any other document.",
  z.string().describe("The file"),
  { params: { ...tripId, documentId: uuid } }
);
