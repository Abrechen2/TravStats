import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { changeHistoryQuerySchema } from "../../../schemas/changeHistory";
import { CHANGE_SOURCES } from "../../changeLedger/context";
import { ENTITY_TYPES } from "../../changeLedger/models";

/**
 * The change history (spec 2026-11-22-change-history): `routes/changeHistory.ts`. Bare.
 */

const historyRow = z.object({
  id: z.string().uuid(),
  changeSetId: z.string().describe("Shared by every field row of one write"),
  entityType: z.enum(ENTITY_TYPES as [string, ...string[]]),
  entityId: z.string(),
  operation: z.enum(["update", "delete"]),
  field: z.string().nullable().describe("Null on a delete row"),
  oldValue: z.unknown().describe("The JSON value before; null when omitted or empty"),
  newValue: z.unknown().describe("The JSON value after; null when omitted or empty"),
  valueType: z.string().nullable().describe("The field's Prisma type, e.g. `String`, `DateTime`"),
  omitted: z.boolean().describe("The value was too large or binary to keep"),
  label: z.string().nullable(),
  source: z.enum(CHANGE_SOURCES),
  actor: z.enum(["self", "other"]).nullable(),
  reason: z.string().nullable(),
  restoredFromId: z.string().nullable(),
  restorable: z.boolean(),
  createdAt: z.string().datetime(),
});

registry.registerPath({
  method: "get",
  path: "/change-history",
  summary: "The change history of the account's travel entries",
  description:
    "Newest first, 100 rows a page; `after` continues after a row id. With `entityType` and " +
    "`entityId`, one entry's history. Only the account's own rows.",
  tags: ["Change history"],
  request: { query: changeHistoryQuerySchema },
  responses: {
    200: {
      description: "One page of rows",
      content: {
        "application/json": {
          schema: z.object({ entries: z.array(historyRow), nextCursor: z.string().nullable() }),
        },
      },
    },
    400: { description: "Invalid query", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/change-history/{id}/restore",
  summary: "Write one recorded value back",
  description:
    "Sets the field to the row's old value. The restore is recorded as a row of its own " +
    "(`restoredFromId`); an empty `restored` means the field already held that value.",
  tags: ["Change history"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "The ledger row the restore wrote",
      content: { "application/json": { schema: z.object({ restored: z.array(historyRow) }) } },
    },
    404: { description: "`CHANGE_NOT_FOUND`", content: errorContent },
    409: { description: "`CHANGE_NOT_RESTORABLE`", content: errorContent },
  },
});
