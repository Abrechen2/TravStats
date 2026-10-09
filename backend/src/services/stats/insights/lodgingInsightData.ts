import { prisma } from "../../../db";
import type { InsightStay } from "../../../utils/lodgingInsights";

/**
 * Every stay of a user, with its house and its trip, for the lodging insights
 * (forgejo#258). Loaded UNFILTERED by year on purpose: coming back to a house
 * over years, and a trip's chain of houses, are lifetime questions — the
 * endpoint answers per year where a figure has a year, and the screen picks.
 * Which stays count is decided downstream by `shared/lodgingCounting.ts`, not
 * by a `where` here, so a status cache that lags its dates changes nothing.
 */
export async function loadLodgingInsightStays(userId: string): Promise<InsightStay[]> {
  const rows = await prisma.lodgingStay.findMany({
    where: { userId },
    select: {
      id: true,
      lodgingId: true,
      checkIn: true,
      checkOut: true,
      datePrecision: true,
      nights: true,
      status: true,
      roomCategory: true,
      board: true,
      currency: true,
      totalPrice: true,
      isAwardStay: true,
      lodging: { select: { name: true, type: true } },
      trip: { select: { id: true, name: true, category: true, endDate: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    lodgingId: r.lodgingId,
    lodgingName: r.lodging.name,
    type: r.lodging.type,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    datePrecision: r.datePrecision,
    nights: r.nights,
    status: r.status,
    roomCategory: r.roomCategory,
    board: r.board,
    currency: r.currency,
    totalPrice: r.totalPrice,
    isAwardStay: r.isAwardStay,
    trip: r.trip
      ? { id: r.trip.id, name: r.trip.name, category: r.trip.category, endDate: r.trip.endDate }
      : null,
  }));
}
