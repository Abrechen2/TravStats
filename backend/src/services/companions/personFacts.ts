import { prisma } from "../../db";
import type { CompanionUseKind } from "./companionJoins";

/** One seat (a cabin on a cruise) the person had on a shared entry. */
export interface PersonSeat {
  kind: CompanionUseKind;
  entryId: string;
  seat: string | null;
  seatClass: string | null;
}

/** A loyalty number the person holds, and the kinds of entry it was recorded on. */
export interface PersonLoyalty {
  number: string;
  kinds: CompanionUseKind[];
}

export interface PersonFacts {
  seats: PersonSeat[];
  loyalty: PersonLoyalty[];
}

interface FactRow {
  kind: CompanionUseKind;
  entryId: string;
  seat?: string | null;
  seatClass?: string | null;
  loyaltyNumber: string | null;
}

/** The person's per-traveller facts (document-links D7) of the kinds the caller sees. */
async function loadFactRows(
  companionId: string,
  kinds: readonly CompanionUseKind[]
): Promise<FactRow[]> {
  const where = { companionId };
  const has = (k: CompanionUseKind): boolean => kinds.includes(k);
  const [flight, rail, bus, ferry, cruise, rental, stay] = await Promise.all([
    has("flight") ? prisma.flightCompanion.findMany({ where }) : [],
    has("rail") ? prisma.railJourneyCompanion.findMany({ where }) : [],
    has("bus") ? prisma.busJourneyCompanion.findMany({ where }) : [],
    has("ferry") ? prisma.ferryJourneyCompanion.findMany({ where }) : [],
    has("cruise") ? prisma.cruiseCompanion.findMany({ where }) : [],
    has("rental") ? prisma.rentalBookingCompanion.findMany({ where }) : [],
    has("lodging") ? prisma.lodgingStayCompanion.findMany({ where }) : [],
  ]);
  const seated = (
    kind: CompanionUseKind,
    rows: { seatNumber: string | null; seatClass: string | null; loyaltyNumber: string | null }[],
    id: (i: number) => string
  ): FactRow[] =>
    rows.map((r, i) => ({
      kind,
      entryId: id(i),
      seat: r.seatNumber,
      seatClass: r.seatClass,
      loyaltyNumber: r.loyaltyNumber,
    }));
  return [
    ...seated("flight", flight, (i) => flight[i].flightId),
    ...seated("rail", rail, (i) => rail[i].railJourneyId),
    ...seated("bus", bus, (i) => bus[i].busJourneyId),
    ...seated("ferry", ferry, (i) => ferry[i].ferryJourneyId),
    ...cruise.map((r) => ({
      kind: "cruise" as const,
      entryId: r.cruiseId,
      seat: r.cabin,
      seatClass: null,
      loyaltyNumber: r.loyaltyNumber,
    })),
    ...rental.map((r) => ({
      kind: "rental" as const,
      entryId: r.rentalBookingId,
      loyaltyNumber: r.loyaltyNumber,
    })),
    ...stay.map((r) => ({
      kind: "lodging" as const,
      entryId: r.lodgingStayId,
      loyaltyNumber: r.loyaltyNumber,
    })),
  ];
}

/**
 * Seats (only on entries in `happened`, as `kind:id` keys — a seat is history)
 * and loyalty numbers (every link row, planned entries included: a number is
 * the person's, not the trip's). Null is "not recorded" and never listed.
 */
export async function loadPersonFacts(
  companionId: string,
  kinds: readonly CompanionUseKind[],
  happened: ReadonlySet<string>
): Promise<PersonFacts> {
  const rows = await loadFactRows(companionId, kinds);
  const seats = rows
    .filter(
      (r) => happened.has(`${r.kind}:${r.entryId}`) && ((r.seat ?? "") !== "" || !!r.seatClass)
    )
    .map((r) => ({
      kind: r.kind,
      entryId: r.entryId,
      seat: r.seat?.trim() || null,
      seatClass: r.seatClass?.trim() || null,
    }));
  const byNumber = new Map<string, Set<CompanionUseKind>>();
  for (const r of rows) {
    const n = r.loyaltyNumber?.trim();
    if (!n) continue;
    const set = byNumber.get(n) ?? new Set<CompanionUseKind>();
    set.add(r.kind);
    byNumber.set(n, set);
  }
  const loyalty = [...byNumber]
    .map(([number, ks]) => ({
      number,
      kinds: kinds.filter((k) => ks.has(k)),
    }))
    .sort((a, b) => a.number.localeCompare(b.number));
  return { seats, loyalty };
}
