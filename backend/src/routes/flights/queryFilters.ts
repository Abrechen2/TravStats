import { Prisma } from "@prisma/client";
import type { FlightQueryInput } from "../../schemas/flight";

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
