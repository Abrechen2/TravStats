import { birthdayOf } from "../timeModel/readDay";
/**
 * The rows `GET /stats/cruise` is built from, loaded once.
 *
 * Extracted from `routes/stats.ts` when the evidence panel began answering
 * the same ten numbers (task 7b-3), for the reason `travelAccountData.ts`
 * gives one domain over: two copies of this query would be two populations,
 * and the first `select` or `where` to move on one side would leave the panel
 * naming rows the tile never counted.
 *
 * Each row carries BOTH the `CruiseData` the calculator consumes and the few
 * extra columns an evidence entry needs to render and link itself — a name, a
 * companion list, the FX snapshot. A second query per page would defeat the
 * point of loading the itineraries in one pass.
 */
import { prisma } from "../../db";
import { countableCruiseWhere } from "../../shared/cruiseCounting";
import { startedIn } from "../../utils/stats/domainYear";
import type { CruiseData } from "../../utils/cruiseStats";
import { cruiseSeaDaysCounted } from "../settings/accountPrefs";

/** One cruise: what the calculator reads, and what an evidence entry shows. */
export interface CruiseStatsRow {
  id: string;
  /** Route name, ship name, line — whatever the row can offer. Never translated. */
  label: string;
  /**
   * The CATALOGUE ship's name, or null where the booking names no catalogue
   * ship. Distinct from `label`, which falls back through the route name and
   * the per-booking override: evidence keyed by `shipId` needs the name that
   * belongs to that id, not the one this booking happened to display.
   */
  shipName: string | null;
  startDate: Date | null;
  /** The names on the booking; `deriveCruiseStats` folds these into its tally. */
  companions: string[];
  /** The trip the cruise is filed under, if any — the fun block's "on a trip". */
  tripId: string | null;
  price: number | null;
  currency: string | null;
  /** FX snapshot (#267). `Cruise` was the last priced model to gain one. */
  priceBase: number | null;
  fxBaseCurrency: string | null;
  /** Exactly what `calculateCruiseStats` is handed for this cruise. */
  input: CruiseData;
}

export interface CruiseStatsData {
  rows: CruiseStatsRow[];
  /** The account's "Seetage zählen" (forgejo#321), stamped on every row's input. */
  countSeaDays: boolean;
  /** 1-12 month, for the birthday-at-sea flag. Undefined when none is set. */
  userBirthday?: { month: number; day: number };
}

/**
 * The SAILED cruises of `year` (or of all time when it is undefined) — the
 * one population every cruise figure reads, spelled with
 * `countableCruiseWhere()` (`shared/cruiseCounting.ts`): a cancelled cruise
 * never counts, a booked one only once it has ended.
 *
 * There used to be a second scope, `every`, for the tab's row-level blocks
 * (rhythm, fun, companions), which counted booked and cancelled cruises too.
 * The owner ruled them out (forgejo#280 point 13), so the scope went with it:
 * a parameter that can pick a second population is how one gets picked.
 */
export async function loadCruiseStatsData(
  userId: string,
  year: number | undefined
): Promise<CruiseStatsData> {
  const [user, cruises, countSeaDays] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { birthdate: true, birthDay: true } }),
    prisma.cruise.findMany({
      where: {
        userId,
        ...countableCruiseWhere(),
        ...startedIn("startDate", year),
      },
      include: {
        stops: { include: { port: true } },
        legs: { orderBy: { ordinal: "asc" }, select: { distanceKm: true } },
        departurePort: true,
        arrivalPort: true,
        ship: { select: { name: true } },
      },
    }),
    cruiseSeaDaysCounted(userId),
  ]);

  const rows: CruiseStatsRow[] = cruises.map((c) => ({
    id: c.id,
    label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.cruiseLine ?? "—",
    shipName: c.ship?.name ?? null,
    startDate: c.startDate,
    companions: c.companions,
    tripId: c.tripId,
    price: c.price,
    currency: c.currency,
    priceBase: c.priceBase,
    fxBaseCurrency: c.fxBaseCurrency,
    input: {
      id: c.id,
      shipId: c.shipId,
      kind: c.kind,
      cruiseLine: c.cruiseLine,
      cabinType: c.cabinType,
      deck: c.deck,
      startDate: c.startDate,
      endDate: c.endDate,
      stops: c.stops.map((s) => ({
        portId: s.portId,
        port: s.port
          ? {
              id: s.port.id,
              name: s.port.name,
              city: s.port.city,
              country: s.port.country,
              region: s.port.region,
              unlocode: s.port.unlocode,
              lat: s.port.lat,
              lon: s.port.lon,
              timezone: s.port.timezone,
              isUserAdded: s.port.isUserAdded,
            }
          : null,
        dayNumber: s.dayNumber,
        isAtSea: s.isAtSea,
        arrivalTime: s.arrivalTime,
        departureTime: s.departureTime,
        unresolvedPortName: s.unresolvedPortName,
      })),
      departurePort: c.departurePort,
      arrivalPort: c.arrivalPort,
      legDistancesKm: c.legs.map((l) => l.distanceKm),
      countSeaDays,
    },
  }));

  // `calculateCruiseStats` expects {month (1-12), day} for the
  // birthday-at-sea flag — a floating date, read by `birthdayOf`.
  const userBirthday = birthdayOf(user);

  return { rows, userBirthday, countSeaDays };
}
