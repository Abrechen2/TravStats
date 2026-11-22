import { prisma } from "../../db";
import { PURPOSE_DOMAINS, type PurposeDomain } from "../../shared/purpose";
import { loadPurposeVisibilitySetting } from "../provenance/purposeVisibility";
import { runUnfiltered } from "../provenance/recordedOnly";

type Counter = { count(args: { where: Record<string, unknown> }): Promise<number> };

/** The Prisma delegate that holds each domain's entries. */
const DELEGATE: Record<PurposeDomain, string> = {
  poi: "placeVisit",
  flight: "flight",
  lodging: "lodgingStay",
  rail: "railJourney",
  bus: "busJourney",
  ferry: "ferryJourney",
  rental: "rentalBooking",
  cruise: "cruise",
};

/**
 * How many entries each domain's "ausblenden" setting leaves out, so a hidden number is never
 * mistaken for a real zero. Counted with no filter open: this is the population the filter drops.
 */
export async function countHiddenByPurpose(
  userId: string
): Promise<Partial<Record<PurposeDomain, Record<string, number>>>> {
  const setting = await loadPurposeVisibilitySetting(userId);
  const out: Partial<Record<PurposeDomain, Record<string, number>>> = {};
  for (const domain of PURPOSE_DOMAINS) {
    const hidden = setting[domain] ?? [];
    if (hidden.length === 0) continue;
    const delegate = (prisma as unknown as Record<string, Counter>)[DELEGATE[domain]];
    const counts: Record<string, number> = {};
    for (const purpose of hidden) {
      counts[purpose] = await runUnfiltered(() => delegate.count({ where: { userId, purpose } }));
    }
    out[domain] = counts;
  }
  return out;
}
