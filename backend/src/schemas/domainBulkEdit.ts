import { z } from "./zod";
import { RAIL_TRAVEL_CLASSES } from "./rail";
import {
  BULK_FIELDS,
  DOMAIN_BULK_MAX,
  type BulkDomain,
  type BulkField,
} from "../shared/bulkEditFields";

/**
 * `POST /<domain>/bulk-edit` (forgejo#405 A4): the flights bulk edit
 * (`flightBulkEdit.ts`) for every other domain, on one shape. A domain accepts
 * only the fields below that it names in `BULK_FIELDS` — anything else is a
 * 400 (strict), so a rail request can never carry a stay's field by accident.
 *
 * Every field is idempotent: sending the same body twice changes nothing the
 * second time, which is what makes "retry the failed ones" safe.
 *
 * `baseVersions` is optional and maps an id to the `updatedAt` the client read
 * it at (the sync precondition of forgejo#141, applied per row): a row that
 * moved on answers `failed / VERSION_CONFLICT` and is not written.
 */

export {
  BULK_DOMAINS,
  BULK_FIELDS,
  BULK_FIELD_NAMES,
  DOMAIN_BULK_MAX,
  type BulkDomain,
  type BulkField,
} from "../shared/bulkEditFields";

export const BULK_EDIT_PATHS: Record<BulkDomain, string> = {
  rail: "/rail/bulk-edit",
  bus: "/bus/bulk-edit",
  ferry: "/ferry/bulk-edit",
  rental: "/rentals/bulk-edit",
  cruise: "/cruises/bulk-edit",
  stay: "/lodging/stays/bulk-edit",
};

export const BULK_RESULT_STATUSES = ["updated", "unchanged", "failed"] as const;
export const BULK_RESULT_CODES = ["NOT_FOUND", "UPDATE_FAILED", "VERSION_CONFLICT"] as const;

const listEdit = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ mode: z.enum(["add", "replace"]), values: z.array(item).max(50) });

const textEdit = (value: z.ZodTypeAny) =>
  z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("set"), value }),
    z.object({ mode: z.literal("clear") }),
  ]);

const text = (max: number) => z.string().trim().min(1).max(max);

function fieldShape(domain: BulkDomain): Record<string, z.ZodTypeAny> {
  const all: Record<BulkField, z.ZodTypeAny> = {
    trip: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("set"), tripId: z.string().uuid() }),
      z.object({ mode: z.literal("clear") }),
    ]),
    tags: listEdit(text(40)),
    companions: listEdit(text(100)),
    // `cancel` marks a row cancelled; `reinstate` takes a cancelled row back to
    // the status its dates give. The other statuses are derived, never typed.
    status: z.object({ mode: z.enum(["cancel", "reinstate"]) }),
    operator: textEdit(text(100)),
    serviceClass: textEdit(domain === "rail" ? z.enum(RAIL_TRAVEL_CLASSES) : text(40)),
  };
  return Object.fromEntries(BULK_FIELDS[domain].map((f) => [f, all[f].optional()]));
}

export function domainBulkEditSchema(domain: BulkDomain) {
  return z
    .object({
      ids: z
        .array(z.string().uuid())
        .min(1)
        .max(DOMAIN_BULK_MAX)
        .refine((ids) => new Set(ids).size === ids.length, { message: "ids must not repeat" }),
      baseVersions: z.record(z.string().uuid(), z.iso.datetime({ offset: true })).optional(),
      ...fieldShape(domain),
    })
    .strict()
    .refine((body) => BULK_FIELDS[domain].some((f) => (body as Record<string, unknown>)[f]), {
      message: `Name at least one of ${BULK_FIELDS[domain].join(", ")}`,
    });
}

/** The superset every domain's parsed body fits into. */
export interface DomainBulkEdit {
  ids: string[];
  baseVersions?: Record<string, string>;
  trip?: { mode: "set"; tripId: string } | { mode: "clear" };
  tags?: { mode: "add" | "replace"; values: string[] };
  companions?: { mode: "add" | "replace"; values: string[] };
  status?: { mode: "cancel" | "reinstate" };
  operator?: { mode: "set"; value: string } | { mode: "clear" };
  serviceClass?: { mode: "set"; value: string } | { mode: "clear" };
}
