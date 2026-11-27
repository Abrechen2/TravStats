import type { EntryType } from "./documentFormats";

/**
 * The text search of the document link picker, as a Prisma `where` per entry
 * type — evaluated by the database, so an entry that is years old (or the
 * thousandth of its type) is found as well as the newest. It used to read the
 * most recent rows per type and filter their labels in memory, which could
 * never reach an older match.
 *
 * Every whitespace-separated term must match somewhere in the entry's label
 * fields (case-insensitive, `contains`), or — for a term that looks like a date
 * (`2026`, `2026-06`, `2026-06-08`) — fall in that period on the entry's date.
 */
type Where = Record<string, unknown>;

interface Fields {
  text: Array<string | [relation: string, field: string]>;
  date?: string;
}

const FIELDS: Record<EntryType, Fields> = {
  flight: { text: ["flightNumber", "depIata", "arrIata"], date: "departureTime" },
  cruise: { text: ["routeName"], date: "startDate" },
  lodgingStay: { text: [["lodging", "name"]], date: "checkIn" },
  trip: { text: ["name"] },
  placeVisit: { text: [["place", "name"]], date: "visitedAt" },
  railJourney: { text: ["depStationName", "arrStationName"], date: "departureTime" },
  rentalBooking: { text: ["pickupStationName", "returnStationName"] },
  busJourney: { text: ["lineName", "depStationName", "arrStationName"], date: "departureTime" },
  ferryJourney: { text: ["vesselName", "depStationName", "arrStationName"], date: "departureTime" },
  tripExpense: { text: ["note", "kind"], date: "date" },
  tour: { text: ["name"] },
};

const DATE_TERM = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** [start, end) of the period a date-like term names, in UTC; null for any other term. */
export function datePeriod(term: string): { gte: Date; lt: Date } | null {
  const m = DATE_TERM.exec(term);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) - 1 : null;
  const dayOfMonth = m[3] ? Number(m[3]) : null;
  if (month !== null && month > 11) return null;
  const gte = new Date(Date.UTC(year, month ?? 0, dayOfMonth ?? 1));
  if (Number.isNaN(gte.getTime())) return null;
  const lt =
    dayOfMonth !== null
      ? new Date(Date.UTC(year, month ?? 0, dayOfMonth + 1))
      : month !== null
        ? new Date(Date.UTC(year, month + 1, 1))
        : new Date(Date.UTC(year + 1, 0, 1));
  return { gte, lt };
}

export function searchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

/** The `where` fragment for `type`, to be spread next to `userId`; empty without terms. */
export function entrySearchWhere(type: EntryType, query: string): Where {
  const terms = searchTerms(query);
  if (terms.length === 0) return {};
  const { text, date } = FIELDS[type];
  return {
    AND: terms.map((term) => {
      const alternatives: Where[] = text.map((field) =>
        typeof field === "string"
          ? { [field]: { contains: term, mode: "insensitive" } }
          : { [field[0]]: { [field[1]]: { contains: term, mode: "insensitive" } } }
      );
      const period = date ? datePeriod(term) : null;
      if (date && period) alternatives.push({ [date]: period });
      return { OR: alternatives };
    }),
  };
}
