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

/** One cruise: what the calculator reads, and what an evidence entry shows. */
export interface CruiseStatsRow {
  id: string;
  /** Route name, ship name, line — whatever the row can offer. Never translated. */
  label: string;
  startDate: Date | null;
  /** The names on the booking; `deriveCruiseStats` folds these into its tally. */
  companions: string[];
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
  /** 1-12 month, for the birthday-at-sea flag. Undefined when none is set. */
  userBirthday?: { month: number; day: number };
}

/**
 * The sailed cruises of `year` (or of all time when it is undefined).
 *
 * The predicate is `countableCruiseWhere()` — this router spelled the same
 * two statuses with the FLIGHT helper, which is the drift
 * `shared/cruiseCounting.ts` exists to end. Both lists are
 * `["flown", "historical"]`, so the extraction changes no row.
 */
export async function loadCruiseStatsData(
  userId: string,
  year: number | undefined
): Promise<CruiseStatsData> {
  const [user, cruises] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { birthdate: true } }),
    prisma.cruise.findMany({
      where: { userId, ...countableCruiseWhere(), ...startedIn("startDate", year) },
      include: {
        stops: { include: { port: true } },
        legs: { orderBy: { ordinal: "asc" }, select: { distanceKm: true } },
        departurePort: true,
        arrivalPort: true,
        ship: { select: { name: true } },
      },
    }),
  ]);

  const rows: CruiseStatsRow[] = cruises.map((c) => ({
    id: c.id,
    label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.cruiseLine ?? "—",
    startDate: c.startDate,
    companions: c.companions,
    price: c.price,
    currency: c.currency,
    priceBase: c.priceBase,
    fxBaseCurrency: c.fxBaseCurrency,
    input: {
      id: c.id,
      shipId: c.shipId,
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
    },
  }));

  // `calculateCruiseStats` expects {month, day} for the birthday-at-sea flag.
  // `Date#getMonth()` is 0-11 and `rangeContainsMonthDay` expects 1-12 —
  // without the +1 a January birthday matched nothing and every other was off
  // by a month (found by a Codex audit).
  const userBirthday = user?.birthdate
    ? { month: user.birthdate.getMonth() + 1, day: user.birthdate.getDate() }
    : undefined;

  return { rows, userBirthday };
}
