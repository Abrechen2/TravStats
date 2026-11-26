/**
 * Smart lists for plain stay findings (prod 26.11.2026): three McDonald's stops stayed pending
 * although the owner's list follows the chain with auto-accept on, because only findings this
 * projection made (with `evidence.visit` and a looked-up venue) were ever matched. A stay
 * finding whose OWN place carries the rule's brand is matched by the same rule — dwell inside
 * the rule's window, the stay within `autoAcceptDistanceM` of the place — and taken through the
 * owner's accept path, marked `brandRule`, so it can be undone.
 *
 * Never claimed: a stop the owner named himself (`ownerStopName`), whatever the place says.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { meters } from "../../dawarich/stays/detect";
import { acceptStay } from "../../dawarich/stays/review";
import { BRAND_RULE, loadBrandRules } from "../../places/brandRules";
import { ownerStopName } from "../stopPlaces/ownerName";
import type { BrandMatch } from "./brandMatch";

/** How far back a pending stay finding is matched, and how many a run takes. */
export const DWELL_BRAND_LOOKBACK_DAYS = 30;
export const DWELL_BRAND_PER_RUN = 10;
const DAY_MS = 86_400_000;

export async function autoAcceptDwellBrands(userId: string, now: Date): Promise<number> {
  const rules = (await loadBrandRules(userId)).filter((r) => r.autoAccept);
  if (rules.length === 0) return 0;
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      provider: "travtrack",
      status: "pending",
      placeId: { not: null },
      sourceStartAt: { gte: new Date(now.getTime() - DWELL_BRAND_LOOKBACK_DAYS * DAY_MS) },
      place: { brandWikidataId: { in: rules.map((r) => r.brandWikidataId) } },
    },
    select: {
      id: true,
      evidence: true,
      tripId: true,
      sourceStartAt: true,
      sourceEndAt: true,
      sourceLat: true,
      sourceLon: true,
      place: { select: { id: true, name: true, lat: true, lon: true, brandWikidataId: true } },
    },
    orderBy: { sourceStartAt: "desc" },
    take: DWELL_BRAND_PER_RUN * 3,
  });
  let accepted = 0;
  for (const row of rows) {
    if (accepted >= DWELL_BRAND_PER_RUN) break;
    const e = (row.evidence ?? {}) as { visit?: unknown; ownerNamed?: unknown };
    // A visit finding is matched on its venue by the projection; an owner-named stop never.
    if (e.visit || e.ownerNamed || !row.place) continue;
    const span = { fromMs: row.sourceStartAt.getTime(), untilMs: row.sourceEndAt.getTime() };
    if (await ownerStopName(userId, span)) continue;
    const minutes = (span.untilMs - span.fromMs) / 60_000;
    const distanceM = meters({ lat: row.sourceLat, lon: row.sourceLon }, row.place);
    const matches: BrandMatch[] = rules
      .filter(
        (r) =>
          r.brandWikidataId === row.place!.brandWikidataId &&
          minutes >= r.minDwellMinutes &&
          minutes <= r.maxDwellMinutes &&
          distanceM <= r.autoAcceptDistanceM
      )
      .map((r) => ({
        ruleId: r.id,
        listId: r.listId,
        listName: r.listName,
        brandWikidataId: r.brandWikidataId,
        brandName: r.brandName,
        strength: "id",
        auto: true,
      }));
    if (matches.length === 0) continue;
    const marked = await prisma.dawarichStay.updateMany({
      where: { id: row.id, userId, status: "pending" },
      data: { evidence: { ...(row.evidence as object), brandMatches: matches } as object },
    });
    if (!marked.count) continue;
    try {
      await acceptStay(
        userId,
        row.id,
        {
          placeId: row.place.id,
          tripId: row.tripId,
          name: row.place.name,
          lat: row.place.lat,
          lon: row.place.lon,
          startAt: { kind: "instant", utc: row.sourceStartAt, bareZ: false },
          endAt: { kind: "instant", utc: row.sourceEndAt, bareZ: false },
        },
        { createdBy: BRAND_RULE }
      );
      accepted++;
    } catch (error) {
      // Left pending in the inbox with its match shown: never a silent loss.
      logger.warn({
        operation: "travtrack.visits.dwellBrandAcceptFailed",
        userId,
        error: (error as Error).message,
      });
    }
  }
  return accepted;
}
