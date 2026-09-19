/**
 * The rows `GET /stats/lodging` is built from, loaded once.
 *
 * The lodging twin of `cruiseStatsData.ts`, extracted for the same reason
 * (task 7b-3): the evidence panel answers ten of this endpoint's own numbers,
 * and a second copy of a query with a membership join, a base-currency lookup
 * and a year window in it would be a second population long before anyone
 * noticed.
 *
 * `LodgingStayData` is the calculator's input shape and deliberately carries
 * no stay ID — nothing in the rollup needs one. An evidence entry does: two
 * stays at the same hotel are two pieces of evidence, and keying them by
 * `lodgingId` would collapse them into one row. So each row here pairs the
 * calculator's input with the identity beside it rather than widening the
 * shared type, which every existing fixture would then have to grow a field
 * for.
 */
import { prisma } from "../../db";
import { getBaseCurrency } from "../fx/snapshot";
import { buildMembershipContext, resolveStayProgramme } from "../lodging/stayMembership";
import { lodgingCountryKey } from "../../utils/stats/lodgingCountryKey";
import { scopeLodgingsToStays, startedIn } from "../../utils/stats/domainYear";
import type { LodgingRecord, LodgingStayData } from "../../utils/lodgingStats";

/** One stay: the calculator's input, plus what an evidence entry needs. */
export interface LodgingStayRow {
  /** The STAY's id — the evidence — which is not what an entry's `href` targets. */
  id: string;
  stay: LodgingStayData;
}

/** One house, for the measures counted over LODGINGS rather than over stays. */
export interface LodgingHouseRow {
  id: string;
  name: string;
  record: LodgingRecord;
}

export interface LodgingStatsData {
  rows: LodgingStayRow[];
  houses: LodgingHouseRow[];
  /** The calculator's inputs, in the order the route used to build them. */
  stays: LodgingStayData[];
  lodgingRecords: LodgingRecord[];
  baseCurrency: string;
}

export async function loadLodgingStatsData(
  userId: string,
  year: number | undefined
): Promise<LodgingStatsData> {
  const [stays, lodgings, baseCurrency, memberships] = await Promise.all([
    prisma.lodgingStay.findMany({
      where: { userId, ...startedIn("checkIn", year) },
      // The chain is joined for its NAME: the price and rating rankings are
      // read by a human, and a chain id is not a label.
      include: { lodging: { include: { chain: true } } },
    }),
    // Every lodging the user HAS, including ones with no stay yet — a hotel
    // added but never checked into must still count toward lodgingsCount and
    // chainsUnique (owner decision). Loaded UNFILTERED on purpose:
    // `visited === false` rows are needed here, not to be counted as visits
    // but to be counted as bookmarks (`notedLodgingsCount`).
    prisma.lodging.findMany({ where: { userId } }),
    // spendBaseTotal is filtered against the CURRENT base currency, so a stay
    // snapshotted under an older one is never silently added under this one's
    // label.
    getBaseCurrency(userId),
    // Which card covered which stay is DERIVED, not stored: a membership
    // attached to a chain covers every stay at that chain without the user
    // restating it per stay.
    prisma.lodgingMembership.findMany({
      where: { userId },
      include: { chains: true, lodgings: true },
    }),
  ]);

  const membershipContext = buildMembershipContext(memberships);
  const scopedLodgings = scopeLodgingsToStays(lodgings, stays, year);
  const houses: LodgingHouseRow[] = scopedLodgings.map((l) => ({
    id: l.id,
    name: l.name,
    record: {
      id: l.id,
      chainId: l.chainId,
      type: l.type,
      country: lodgingCountryKey(l),
      city: l.city,
      visited: l.visited,
    },
  }));

  const rows: LodgingStayRow[] = stays.map((s) => {
    const programme = resolveStayProgramme(s, s.lodging.chainId, membershipContext);
    return {
      id: s.id,
      stay: {
        lodgingId: s.lodgingId,
        lodgingName: s.lodging.name,
        type: s.lodging.type,
        country: lodgingCountryKey(s.lodging),
        city: s.lodging.city,
        chainId: s.lodging.chainId,
        chainName: s.lodging.chain?.name ?? null,
        stars: s.lodging.stars,
        lat: s.lodging.lat,
        lon: s.lodging.lon,
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        datePrecision: s.datePrecision,
        nights: s.nights,
        status: s.status,
        totalPriceBase: s.totalPriceBase,
        fxBaseCurrency: s.fxBaseCurrency,
        currency: s.currency,
        totalPrice: s.totalPrice,
        board: s.board,
        isAwardStay: s.isAwardStay,
        ratingOverall: s.ratingOverall,
        ratingRoom: s.ratingRoom,
        ratingBreakfast: s.ratingBreakfast,
        ratingService: s.ratingService,
        programName: programme.programName,
        membershipTier: programme.tier,
      },
    };
  });

  return {
    rows,
    houses,
    stays: rows.map((r) => r.stay),
    lodgingRecords: houses.map((h) => h.record),
    baseCurrency,
  };
}
