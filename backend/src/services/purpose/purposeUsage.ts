import { prisma } from "../../db";
import { runUnfiltered } from "../provenance/recordedOnly";
import { loadPurposeVisibilitySetting } from "../provenance/purposeVisibility";
import type { Purpose, PurposeDomain } from "../../shared/purpose";
import { effectivePurposeKey } from "../../shared/purposeCatalogue";
import { PURPOSE_FILTER_UNKNOWN } from "./purposeFilter";

/**
 * How many of the user's entries each purpose has, per domain — the numbers beside the options of
 * the purpose filter. Counted by the same effective key the chip shows, `unknown` for entries
 * without a purpose, and without what the user hides (a hidden kind is no option to filter to).
 */
type Group = { purpose: string | null; purposeKey: string | null; _count: { _all: number } };
type Grouper = { groupBy(args: unknown): Promise<Group[]> };

const MODEL_DOMAIN: [string, PurposeDomain][] = [
  ["placeVisit", "poi"],
  ["flight", "flight"],
  ["lodgingStay", "lodging"],
  ["railJourney", "rail"],
  ["busJourney", "bus"],
  ["ferryJourney", "ferry"],
  ["rentalBooking", "rental"],
  ["cruise", "cruise"],
];

export type PurposeUsage = Partial<Record<PurposeDomain, Record<string, number>>>;

export async function purposeUsage(userId: string): Promise<PurposeUsage> {
  const [visibility, customs] = await Promise.all([
    loadPurposeVisibilitySetting(userId),
    prisma.customPurpose.findMany({ where: { userId }, select: { id: true, kind: true } }),
  ]);
  const kinds = new Map(customs.map((c) => [c.id, c.kind as Purpose]));
  const by = ["purpose", "purposeKey"];
  const out: PurposeUsage = {};
  const add = (domain: PurposeDomain, rows: Group[]): void => {
    const hidden = visibility[domain] ?? [];
    const counts: Record<string, number> = { ...(out[domain] ?? {}) };
    for (const r of rows) {
      if (r.purpose && hidden.includes(r.purpose as Purpose)) continue;
      const key =
        effectivePurposeKey(r.purpose, r.purposeKey, (id) => kinds.get(id)) ??
        PURPOSE_FILTER_UNKNOWN;
      counts[key] = (counts[key] ?? 0) + r._count._all;
    }
    out[domain] = counts;
  };
  await runUnfiltered(async () => {
    const groups = await Promise.all(
      MODEL_DOMAIN.map(([model]) =>
        (prisma as unknown as Record<string, Grouper>)[model].groupBy({
          by,
          where: { userId },
          _count: { _all: true },
        })
      )
    );
    MODEL_DOMAIN.forEach(([, domain], i) => add(domain, groups[i]));
    for (const kind of ["tour", "roadtrip"] as const) {
      add(
        kind,
        await (prisma as unknown as Record<string, Grouper>).tripRoute.groupBy({
          by,
          where: { userId, kind },
          _count: { _all: true },
        })
      );
    }
  });
  return out;
}
