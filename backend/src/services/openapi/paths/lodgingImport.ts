/**
 * The lodging import's preview and commit (forgejo#303: the commit names the stays it created and
 * files a document with the first). The rest of the import routes live in `integrations.ts`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const badInput = { description: "Invalid input", content: errorContent };
const importTag = ["Import"];

registry.registerPath({
  method: "post",
  path: "/lodging-import/preview",
  summary: "Preview a lodging import",
  tags: importTag,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ candidates: z.array(z.record(z.string(), z.unknown())).min(1) }),
        },
      },
    },
  },
  responses: { 200: { description: "Preview" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/lodging-import/suggest-mapping",
  summary: "Guess which column means what",
  tags: importTag,
  responses: { 200: { description: "Suggested mapping" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/lodging-import/commit",
  summary: "Write a previewed lodging import",
  description:
    "`createdStayRefs` names every stay this run created (row, stay id, lodging id), so a caller " +
    "can file a document with one. `documentIds` (kept documents, POST /documents) are filed with " +
    "the FIRST created stay; `documentFiled` and `documentNotFiledReason` say whether that happened.",
  tags: importTag,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            source: z.string(),
            fileName: z.string().nullable(),
            rows: z.array(z.record(z.string(), z.unknown())),
            documentIds: z.array(z.string().uuid()).max(20).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Imported",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              batchId: z.string().uuid(),
              createdLodgings: z.number().int(),
              createdStays: z.number().int(),
              updatedStays: z.number().int(),
              createdStayRefs: z.array(
                z.object({
                  sourceRowIndex: z.number().int(),
                  stayId: z.string().uuid(),
                  lodgingId: z.string().uuid(),
                })
              ),
              skipped: z.number().int(),
              failed: z.array(
                z.object({ sourceRowIndex: z.number().int(), code: z.string(), error: z.string() })
              ),
              documentFiled: z.boolean().optional(),
              documentNotFiledReason: z.enum(["no_stay_created", "link_failed"]).optional(),
            }),
          }),
        },
      },
    },
    400: badInput,
  },
});
