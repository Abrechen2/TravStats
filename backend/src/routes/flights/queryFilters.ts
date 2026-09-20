import { Prisma } from "../../prisma";
import { prisma } from "../../db";
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

/**
 * The first and last calendar year (UTC) the account's flights fall into.
 *
 * Needed for one case only: a month filter that names no year — "every March
 * I have ever flown". Prisma cannot express `EXTRACT(MONTH FROM …)`, so that
 * question becomes one date range per year, and the range list has to be
 * bounded by something real rather than by a guessed century. Measured on the
 * owner's account: 12 years, so twelve ranges.
 *
 * `null` when the account holds no dated flight at all — then no month can
 * match, which the caller turns into an empty result rather than a silently
 * dropped filter.
 */
export const departureYearSpan = async (
  userId: string
): Promise<{ min: number; max: number } | null> => {
  const bounds = await prisma.flight.aggregate({
    where: { userId, departureTime: { not: null } },
    _min: { departureTime: true },
    _max: { departureTime: true },
  });
  const min = bounds._min.departureTime;
  const max = bounds._max.departureTime;
  if (!min || !max) return null;
  return { min: min.getUTCFullYear(), max: max.getUTCFullYear() };
};

/** Half-open UTC range for a calendar year, or for one month inside it. */
const utcRange = (year: number, month?: number): Prisma.DateTimeFilter =>
  month === undefined
    ? { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }
    : { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };

export interface FlightWhereOptions {
  /** Only consulted for a `month` without a `year` — see `departureYearSpan`. */
  yearSpan?: { min: number; max: number } | null;
}

export const buildFlightWhere = (
  query: FlightQueryInput & { tags?: string[] },
  userId: string,
  options: FlightWhereOptions = {}
) => {
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

  // Calendar year / month of the departure, in UTC (see the schema).
  if (query.year !== undefined) {
    andConditions.push({ departureTime: utcRange(query.year, query.month) });
  } else if (query.month !== undefined) {
    const span = options.yearSpan;
    if (!span) {
      noResults = true;
    } else {
      const years: number[] = [];
      for (let y = span.min; y <= span.max; y += 1) years.push(y);
      andConditions.push({
        OR: years.map((y) => ({ departureTime: utcRange(y, query.month) })),
      });
    }
  }

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
