/**
 * The name the owner gave a stop (`travtrack_stop_places`), looked up for a finding's span. It
 * always wins over a guess: a venue lookup, a brand rule or a nearby place never renames or
 * claims a stop the owner named (prod 24.11.2026: the owner named a stop "Aldi Süd" and the
 * finding kept offering "McDonald's Sonthofen").
 */
import { prisma } from "../../../db";
import { overlapShare } from "../../locationEvidence/journeys/entryWindows";

export type OwnerStopName = { name: string; lat: number | null; lon: number | null };

/** The newest owner name whose span and the finding's share more than half of either. */
export async function ownerStopName(
  userId: string,
  span: { fromMs: number; untilMs: number }
): Promise<OwnerStopName | null> {
  const rows = await prisma.travTrackStopPlace.findMany({
    where: { userId, fromMs: { lt: BigInt(span.untilMs) }, untilMs: { gt: BigInt(span.fromMs) } },
    select: { name: true, lat: true, lon: true, fromMs: true, untilMs: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  const hit = rows.find((r) => {
    const named = { fromMs: Number(r.fromMs), untilMs: Number(r.untilMs) };
    return overlapShare(span, named) > 0.5 || overlapShare(named, span) > 0.5;
  });
  return hit ? { name: hit.name, lat: hit.lat, lon: hit.lon } : null;
}

/**
 * The owner named a stop: its open TravTrack findings take that name, drop a place, brand or
 * venue guess, and say so (`ownerNamed`), so neither the inbox nor a brand rule offers the guess.
 */
export async function applyOwnerName(
  userId: string,
  span: { fromMs: number; untilMs: number },
  name: string
): Promise<number> {
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      provider: "travtrack",
      status: "pending",
      sourceStartAt: { lt: new Date(span.untilMs) },
      sourceEndAt: { gt: new Date(span.fromMs) },
    },
    select: { id: true, evidence: true, sourceStartAt: true, sourceEndAt: true },
  });
  let n = 0;
  for (const r of rows) {
    const own = { fromMs: r.sourceStartAt.getTime(), untilMs: r.sourceEndAt.getTime() };
    if (overlapShare(own, span) <= 0.5 && overlapShare(span, own) <= 0.5) continue;
    const prior = (r.evidence ?? {}) as Record<string, unknown> & {
      visit?: Record<string, unknown>;
    };
    const { brandMatches: _b, ...rest } = prior;
    const visit = prior.visit ? (({ brandMatches: _v, ...v }) => v)(prior.visit) : undefined;
    const done = await prisma.dawarichStay.updateMany({
      where: { id: r.id, userId, status: "pending" },
      data: {
        name,
        placeId: null,
        evidence: { ...rest, ...(visit ? { visit } : {}), ownerNamed: true } as object,
      },
    });
    n += done.count;
  }
  return n;
}
