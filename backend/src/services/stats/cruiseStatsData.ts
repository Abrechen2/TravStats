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
 * Which cruises a caller is asking about.
 *
 * `sailed` is `GET /stats/cruise`'s own population and the default: a
 * merely-booked voyage must not inflate "gefahren" figures. `every` is
 * `GET /cruises`, which applies no status filter at all — the cruise LIST is
 * what the tab's row-level blocks (the calendar, the money, the companions)
 * are folded from, and they show a booked cruise because the list does.
 *
 * The two populations really do differ, and the difference is visible on the
 * tab: the hero grid counts sailed cruises while the companion bars below it
 * include next year's booking. Naming both here is what keeps a resolver from
 * silently picking the wrong one.
 */
export type CruiseStatusScope = "sailed" | "every";

/**
 * The cruises of `year` (or of all time when it is undefined), under the
 * requested status scope.
 *
 * `sailed` spells the predicate with `countableCruiseWhere()` — this router
 * spelled the same two statuses with the FLIGHT helper, which is the drift
 * `shared/cruiseCounting.ts` exists to end. Both lists are
 * `["flown", "historical"]`, so the extraction changed no row.
 */
export async function loadCruiseStatsData(
  userId: string,
  year: number | undefined,
  statuses: CruiseStatusScope = "sailed"
): Promise<CruiseStatsData> {
  const [user, cruises] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { birthdate: true } }),
    prisma.cruise.findMany({
      where: {
        userId,
        ...(statuses === "sailed" ? countableCruiseWhere() : {}),
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
  ]);

  const rows: CruiseStatsRow[] = cruises.map((c) => ({
    id: c.id,
    label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.cruiseLine ?? "—",
    shipName: c.ship?.name ?? null,
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
