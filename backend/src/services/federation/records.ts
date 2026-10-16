import { z } from "zod";
import { collectComparison } from "./e2e/source";
import type { PreparedScope } from "./permissions";
import { refused } from "./security";

/**
 * Which section of the published comparison a domain's consent preview shows. The preview is
 * cut from the very projection that gets encrypted (collectComparison + fieldInventory.json):
 * a second field list here once disagreed with the published one, so the consent screen showed
 * a friend less than was actually sent.
 */
export const RECORD_SECTIONS = {
  flight: "flights",
  cruise: "cruises",
  lodging: "lodgingStays",
  rail: "railJourneys",
  bus: "busJourneys",
  ferry: "ferryJourneys",
  rental: "rentalBookings",
  roadtrip: "tourRoutes",
  poi: "placeVisits",
} as const;
export type RecordDomain = keyof typeof RECORD_SECTIONS;
export const recordDomain = z.enum(
  Object.keys(RECORD_SECTIONS) as [RecordDomain, ...RecordDomain[]]
);

const PREVIEW_ROWS = 100;
const NESTED_PREVIEW_CHARS = 500;
const scalar = z.union([z.string().max(50_000), z.number().finite(), z.boolean(), z.null()]);
export const recordPageSchema = z.strictObject({
  domain: recordDomain,
  nextCursor: z.null(),
  rows: z
    .array(
      z.strictObject({
        key: z.string().max(100),
        fields: z.array(z.strictObject({ name: z.string().max(100), value: scalar })).max(300),
      })
    )
    .max(PREVIEW_ROWS),
});
export type RecordPage = z.infer<typeof recordPageSchema>;

function previewValue(value: unknown): z.infer<typeof scalar> {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.join(", ");
  // Nested relations and JSON columns are sent too; the preview names them instead of hiding them.
  const text = JSON.stringify(value);
  return text.length > NESTED_PREVIEW_CHARS ? `${text.slice(0, NESTED_PREVIEW_CHARS)}…` : text;
}

/** The first rows of one domain exactly as a grant with this scope would publish them. */
export async function previewRecords(
  userId: string,
  scope: PreparedScope,
  domain: RecordDomain
): Promise<RecordPage> {
  if (!scope.details || !scope.domains.includes(domain)) throw refused();
  // Narrowing to the one domain loads less; a domain's own rows do not depend on the others.
  const published = await collectComparison(userId, {
    ...scope,
    domains: [domain],
    allExisting: !!scope.allExisting,
  });
  const rows = (published.sections[RECORD_SECTIONS[domain]] ?? []) as Array<
    Record<string, unknown>
  >;
  return recordPageSchema.parse({
    domain,
    nextCursor: null,
    rows: rows.slice(0, PREVIEW_ROWS).map((row, index) => ({
      key: typeof row.id === "string" ? row.id : String(index),
      fields: Object.entries(row).map(([name, value]) => ({ name, value: previewValue(value) })),
    })),
  });
}
