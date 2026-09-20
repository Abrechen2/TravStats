import { Prisma } from "../../prisma";
import { flightIdsInLocalPeriod } from "./departureLocalDay";
import {
  SPECIAL_TYPE_FILTER_ANY,
  SPECIAL_TYPE_FILTER_NONE,
  TRIP_FILTER_ANY,
  TRIP_FILTER_NONE,
  type FlightQueryInput,
} from "../../schemas/flight";

/**
 * Query parameters -> a Prisma `where` for the flights list.
 *
 * One job, lifted out of `routes/flights.ts`: the route file crossed its
 * frozen size when main's whole-tree formatting met this branch, and this is
 * the seam that was already there — every line below turns request text into
 * a filter, and none of it touches a response.
 */
// Normalize query params coming from axios (arrays are sent as foo[] by default)
export const normalizeQueryParams = (
  query: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> => {
  const normalized: Record<string, string | string[] | undefined> = {};

  Object.entries(query).forEach(([key, value]) => {
    const normalizedKey = key.endsWith("[]") ? key.slice(0, -2) : key;
    normalized[normalizedKey] = value;
  });

  return normalized;
};

// Convert a potentially pipe/comma separated string or array into a clean string array
export const splitMultiValue = (value?: string | string[]) => {
  if (!value) return [];

  const raw = Array.isArray(value) ? value : value.split(",");

  return raw
    .flatMap((v) => v.split("|"))
    .map((v) => v.trim())
    .filter(Boolean);
};

export const buildFlightWhere = (query: FlightQueryInput & { tags?: string[] }, userId: string) => {
  const andConditions: Prisma.FlightWhereInput[] = [{ userId }];
  let noResults = false;

  // Airlines (allow multiple selections)
  const airlines = splitMultiValue(query.airline);
  if (airlines.length === 1) {
    andConditions.push({ airline: { contains: airlines[0], mode: "insensitive" } });
  } else if (airlines.length > 1) {
    andConditions.push({
      OR: airlines.map((airline) => ({
        airline: { contains: airline, mode: "insensitive" },
      })),
    });
  }

  if (query.flightNumber) {
    andConditions.push({ flightNumber: { contains: query.flightNumber, mode: "insensitive" } });
  }

  if (query.departureAirport) {
    andConditions.push({
      OR: [
        { depIata: { contains: query.departureAirport, mode: "insensitive" } },
        { depIcao: { contains: query.departureAirport, mode: "insensitive" } },
        { depName: { contains: query.departureAirport, mode: "insensitive" } },
      ],
    });
  }

  if (query.arrivalAirport) {
    andConditions.push({
      OR: [
        { arrIata: { contains: query.arrivalAirport, mode: "insensitive" } },
        { arrIcao: { contains: query.arrivalAirport, mode: "insensitive" } },
        { arrName: { contains: query.arrivalAirport, mode: "insensitive" } },
      ],
    });
  }

  // Status (allow multiple selections, explicit empty means no results)
  const statuses = splitMultiValue(query.status) as Array<
    "scheduled" | "flown" | "cancelled" | "historical" | "duplicated"
  >;
  if (Array.isArray(query.status) && query.status.length === 0) {
    noResults = true;
  } else if (statuses.length === 1) {
    andConditions.push({ status: statuses[0] });
  } else if (statuses.length > 1) {
    andConditions.push({ status: { in: statuses } });
  }

  if (query.category) {
    andConditions.push({ category: query.category });
  }

  // Tags
  const tags = query.tags || [];
  if (tags.length > 0) {
    andConditions.push({ tags: { hasEvery: tags } });
  }

  // Price range
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const price: Prisma.FloatNullableFilter = {};
    if (query.minPrice !== undefined) price.gte = query.minPrice;
    if (query.maxPrice !== undefined) price.lte = query.maxPrice;
    andConditions.push({ price });
  }

  // Exact carrier — the facet list's own filter, see the schema for why it is
  // not `airline`.
  if (query.airlineExact) {
    andConditions.push({ airline: query.airlineExact });
  }

  // Free text across the columns a logbook row shows.
  if (query.q) {
    const needle = query.q;
    const like = { contains: needle, mode: "insensitive" } as const;
    andConditions.push({
      OR: [
        { flightNumber: like },
        { airline: like },
        { airlineIata: like },
        { airlineIcao: like },
        { depIata: like },
        { arrIata: like },
        { depIcao: like },
        { arrIcao: like },
        { depName: like },
        { arrName: like },
      ],
    });
  }

  if (query.tripId === TRIP_FILTER_ANY) {
    andConditions.push({ tripId: { not: null } });
  } else if (query.tripId === TRIP_FILTER_NONE) {
    andConditions.push({ tripId: null });
  } else if (query.tripId) {
    andConditions.push({ tripId: query.tripId });
  }

  if (query.specialType === SPECIAL_TYPE_FILTER_NONE) {
    andConditions.push({ specialType: null });
  } else if (query.specialType === SPECIAL_TYPE_FILTER_ANY) {
    andConditions.push({ specialType: { not: null } });
  } else if (query.specialType) {
    andConditions.push({ specialType: query.specialType });
  }

  // `year` and `month` are deliberately NOT here. They are read on the
  // departure airport's clock, which is not a column — see
  // `resolveFlightWhere` below and `departureLocalDay.ts`.

  // Date range
  if (query.fromDate || query.toDate) {
    const departureTime: Prisma.DateTimeFilter = {};
    if (query.fromDate) departureTime.gte = new Date(query.fromDate);
    if (query.toDate) departureTime.lte = new Date(query.toDate);
    andConditions.push({ departureTime });
  }

  return {
    where: { AND: andConditions },
    noResults,
  };
};

/**
 * `buildFlightWhere`, plus the one filter that cannot be a where-clause.
 *
 * `year` and `month` name a day on the DEPARTURE AIRPORT'S calendar, which is
 * this project's one answer to "which day was that" (`airportCalendarDay`,
 * forgejo#46) and the one the table cell beside the filter already draws. It
 * is not a column and cannot be expressed in a Prisma `where`, so the ids are
 * resolved first and handed to the page query. `departureLocalDay.ts` says
 * why this is not a SQL expression.
 *
 * Every caller that pages or counts flights goes through here rather than
 * through `buildFlightWhere` directly, so the list, the facets and the map
 * cannot answer the question three ways.
 */
export const resolveFlightWhere = async (
  query: FlightQueryInput & { tags?: string[] },
  userId: string
): Promise<{ where: Prisma.FlightWhereInput; noResults: boolean }> => {
  const base = buildFlightWhere(query, userId);
  if (base.noResults) return base;
  if (query.year === undefined && query.month === undefined) return base;

  const ids = await flightIdsInLocalPeriod(base.where, { year: query.year, month: query.month });
  // An empty id list is not `{ id: { in: [] } }` — that is a valid query, but
  // saying so outright spares the caller a round trip and matches the
  // `noResults` contract the status filter already uses.
  if (ids.length === 0) return { where: base.where, noResults: true };
  return { where: { AND: [base.where, { id: { in: ids } }] }, noResults: false };
};
