import { z } from "./zod";

/**
 * `GET /stats/domain-records` — the travel records beyond flights
 * (forgejo#265). Described once, inferred by `services/stats/domainRecords.ts`
 * and registered for the spec by `services/openapi/paths/statsDomainRecords.ts`.
 */
export const domainRecordSchema = z
  .object({
    domain: z.enum(["cruise", "lodging", "poi", "roadtrip", "rail", "rental", "bus"]),
    id: z
      .enum([
        "longest-cruise",
        "longest-stay",
        "most-visited-place",
        "longest-roadtrip",
        "longest-rail-ride",
        "longest-rental",
        "longest-bus-ride",
      ])
      .openapi({ description: "A slug, not copy — every client names it in its own language." }),
    value: z.number(),
    unit: z.enum(["days", "nights", "visits", "km"]),
    entryId: z.string(),
    href: z.string().openapi({ description: "The page of the entry that holds the record." }),
    label: z.string().nullable().openapi({
      description: "The entry's own name (a route, a house, a place) — data, not copy.",
    }),
    distanceSource: z
      .string()
      .nullable()
      .optional()
      .openapi({
        description:
          "For a distance record: which distance it is — great_circle (straight line, " +
          "which understates the track), route, user (ticket), roadtrip.",
      }),
  })
  .openapi("DomainRecord");

export const domainRecordsResponseSchema = z.object({
  records: z.array(domainRecordSchema).openapi({
    description:
      "At most one per domain the user sees, each in its own unit, never ranked against " +
      "each other. A domain with nothing measurable has none — never a zero record.",
  }),
});

export type DomainRecord = z.infer<typeof domainRecordSchema>;
