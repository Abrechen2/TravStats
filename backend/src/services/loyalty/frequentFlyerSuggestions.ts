/**
 * Frequent-flyer cards the logbook already knows about.
 *
 * A flight can carry the frequent-flyer number it was booked with — parsed
 * from the confirmation or typed into the form — long before the user ever
 * records the card itself. This turns those numbers into SUGGESTED cards the
 * user confirms on the loyalty page. Nothing is written here.
 *
 * Grouped by NUMBER, not by (airline, number): one Miles & More number is
 * used on Lufthansa, SWISS and Austrian flights alike, and that is one card
 * covering three airlines, not three cards with the same number. The
 * airlines a number was used with become the suggested card's coverage.
 *
 * A number that already sits on one of the user's flight cards is not
 * suggested again — confirming a suggestion must make it disappear.
 */
import { prisma } from "../../db";
import { airlineGroupKey, normalizeAirline } from "../../shared/airlineNormalize";
import { airlineResolvers } from "../../utils/airlineNormalize";

export interface SuggestedAirline {
  /** IATA code when the catalogue knows the carrier, else null. */
  code: string | null;
  name: string;
}

export interface FrequentFlyerSuggestion {
  membershipNumber: string;
  /** The airline the number was used with most often — a prefill, the user renames it. */
  suggestedProgramName: string;
  airlines: SuggestedAirline[];
  flightCount: number;
  /** The latest departure the number was used on (YYYY-MM-DD), or null. */
  lastUsed: string | null;
}

export interface NumberedFlight {
  frequentFlyerNumber: string | null;
  airline: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
  departureTime: Date | null;
}

/** Two spellings of one number — "LH 992 003" and "lh992003" — are one card. */
export function numberKey(raw: string | null | undefined): string | null {
  const key = raw?.replace(/\s+/g, "").toUpperCase();
  return key ? key : null;
}

interface Group {
  spelling: string;
  count: number;
  lastUsed: string | null;
  airlines: Map<string, { airline: SuggestedAirline; count: number }>;
}

export function buildFrequentFlyerSuggestions(
  flights: readonly NumberedFlight[],
  knownNumbers: readonly (string | null)[]
): FrequentFlyerSuggestion[] {
  const known = new Set(knownNumbers.map(numberKey).filter((k): k is string => k !== null));
  const groups = new Map<string, Group>();

  for (const flight of flights) {
    const key = numberKey(flight.frequentFlyerNumber);
    if (key === null || known.has(key)) continue;
    const group = groups.get(key) ?? {
      spelling: flight.frequentFlyerNumber!.trim(),
      count: 0,
      lastUsed: null,
      airlines: new Map(),
    };
    group.count += 1;
    const departed = flight.departureTime?.toISOString().slice(0, 10) ?? null;
    if (departed !== null && (group.lastUsed === null || departed > group.lastUsed)) {
      group.lastUsed = departed;
    }

    const airlineKey = airlineGroupKey(flight, airlineResolvers);
    if (airlineKey !== null) {
      const code = airlineKey.startsWith("iata:") ? airlineKey.slice(5) : null;
      const name =
        (code ? airlineResolvers.nameForIata(code) : null) ??
        (flight.airline ? normalizeAirline(flight.airline) : code) ??
        airlineKey;
      const entry = group.airlines.get(airlineKey) ?? { airline: { code, name }, count: 0 };
      entry.count += 1;
      group.airlines.set(airlineKey, entry);
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const airlines = [...group.airlines.values()].sort(
        (a, b) => b.count - a.count || a.airline.name.localeCompare(b.airline.name)
      );
      return {
        membershipNumber: group.spelling,
        suggestedProgramName: airlines[0]?.airline.name ?? group.spelling,
        airlines: airlines.map((a) => a.airline),
        flightCount: group.count,
        lastUsed: group.lastUsed,
      };
    })
    .sort(
      (a, b) =>
        b.flightCount - a.flightCount || a.membershipNumber.localeCompare(b.membershipNumber)
    );
}

export async function loadFrequentFlyerSuggestions(
  userId: string
): Promise<FrequentFlyerSuggestion[]> {
  const [flights, cards] = await Promise.all([
    prisma.flight.findMany({
      where: {
        userId,
        AND: [{ frequentFlyerNumber: { not: null } }, { NOT: { frequentFlyerNumber: "" } }],
      },
      select: {
        frequentFlyerNumber: true,
        airline: true,
        airlineIata: true,
        airlineIcao: true,
        departureTime: true,
      },
    }),
    prisma.loyaltyMembership.findMany({
      where: { userId, domain: "flight" },
      select: { membershipNumber: true },
    }),
  ]);
  return buildFrequentFlyerSuggestions(
    flights,
    cards.map((c) => c.membershipNumber)
  );
}
