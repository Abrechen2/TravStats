import { prisma } from "../../db";
import { airportFactsFor } from "../../routes/trips/tripCountries";
import { isValidZone } from "../../shared/time/zonedParts";
import { placeholderDayOf } from "../../shared/time/legacyValues";
import { toLocal } from "../../shared/time/instant";
import { bookStrings } from "./strings";
import type { BookEntry, BookLang, DocKind, EntryKind, MapPoint } from "./types";

/**
 * The domain tables of one scope (one trip, or the entries with no trip) as
 * dated book entries. Nothing here invents a date: an instant is turned into a
 * day only through its own zone, and an entry with no instant is `day: null`.
 */

/** Which `DocumentLink` column names which kind of entry. */
export const LINK_COLUMN: Partial<Record<EntryKind, string>> = {
  flight: "flightId",
  rail: "railJourneyId",
  bus: "busJourneyId",
  ferry: "ferryJourneyId",
  rental: "rentalBookingId",
  cruise: "cruiseId",
  stay: "lodgingStayId",
  visit: "placeVisitId",
};

export interface RawEntry {
  entry: BookEntry;
  /** The row id, to attach documents and photos. */
  dbId: string;
}

export interface LoadedEntries {
  items: RawEntry[];
  points: MapPoint[];
  legs: Array<[MapPoint, MapPoint]>;
  flights: Array<{ depIata: string | null; arrIata: string | null }>;
}

export interface WhenOf {
  day: string | null;
  time: string | null;
  ms: number | null;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The local day and clock of an instant in its own zone; no zone = the UTC day, no clock. */
export function whenOf(instant: Date | null, zone: string | null | undefined): WhenOf {
  if (!instant || Number.isNaN(instant.getTime())) return { day: null, time: null, ms: null };
  if (zone && isValidZone(zone)) {
    const local = toLocal(instant, zone).local;
    return { day: local.slice(0, 10), time: local.slice(11, 16), ms: instant.getTime() };
  }
  return { day: isoDay(instant), time: null, ms: instant.getTime() };
}

const clock = (
  instant: Date | null,
  zone: string | null | undefined,
  semantics?: string | null,
  precision?: string | null
): string | null => stampOf(instant, zone, semantics, precision).time;

/**
 * `whenOf` honouring how the row was written: a date-only stamp or a stored
 * `day`/`unknown` precision has no clock to show, and a legacy wall-clock
 * stored as fake UTC reads its day and time straight from the stored value
 * (converting it through the zone would shift it by the zone's offset).
 */
export function stampOf(
  instant: Date | null,
  zone: string | null | undefined,
  semantics?: string | null,
  precision?: string | null
): WhenOf {
  if (!instant || Number.isNaN(instant.getTime())) return { day: null, time: null, ms: null };
  const noClock = precision === "day" || precision === "unknown" || semantics === "DATE_ONLY";
  if (semantics === "DATE_ONLY") return { day: isoDay(instant), time: null, ms: instant.getTime() };
  if (semantics === "LEGACY_FAKE_UTC") {
    return {
      day: isoDay(instant),
      time: noClock ? null : instant.toISOString().slice(11, 16),
      ms: instant.getTime(),
    };
  }
  const when = whenOf(instant, zone);
  return noClock ? { ...when, time: null } : when;
}

/**
 * `YYYY` / `YYYY-MM` for a row whose stored date is only a period's placeholder (the 1st, 00:00 UTC),
 * else null. The stored precision decides; the legacy `UNKNOWN`-semantics placeholder shape counts too.
 */
function partialOf(
  instant: Date,
  semantics?: string | null,
  precision?: string | null
): string | null {
  const iso = instant.toISOString().slice(0, 10);
  if (precision === "year") return iso.slice(0, 4);
  if (precision === "month") return iso.slice(0, 7);
  const legacy = placeholderDayOf(instant, semantics, precision);
  if (!legacy) return null;
  return legacy.slice(5) === "01-01" ? legacy.slice(0, 4) : legacy.slice(0, 7);
}

/** A coordinate pair that is really there: 0,0 is the column default of an unfilled airport. */
function point(
  lat: number | null | undefined,
  lon: number | null | undefined,
  label: string
): MapPoint | null {
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, label };
}

function join(parts: Array<string | null | undefined>, sep = " "): string {
  return parts.filter((p): p is string => !!p && p.trim() !== "").join(sep);
}

function span(from: string | null, to: string | null): string | null {
  return from && to ? `${from} → ${to}` : (from ?? to);
}

function base(
  kind: EntryKind,
  id: string,
  when: WhenOf,
  title: string,
  extra: Partial<BookEntry> = {}
): BookEntry {
  return {
    kind,
    id: `${kind}:${id}`,
    day: when.day,
    time: when.time,
    sortMs: when.ms,
    endDay: null,
    title,
    detail: [],
    notes: null,
    evidence: [] as DocKind[],
    photos: [],
    ...extra,
  };
}

export async function loadEntries(
  userId: string,
  tripId: string | null,
  lang: BookLang
): Promise<LoadedEntries> {
  const s = bookStrings(lang);
  const own = { userId, tripId, NOT: { status: "cancelled" } };
  const [flights, rails, buses, ferries, rentals, cruises, stays, visits, journal] =
    await Promise.all([
      prisma.flight.findMany({ where: own, orderBy: { id: "asc" } }),
      prisma.railJourney.findMany({ where: own, orderBy: { id: "asc" } }),
      prisma.busJourney.findMany({ where: own, orderBy: { id: "asc" } }),
      prisma.ferryJourney.findMany({ where: own, orderBy: { id: "asc" } }),
      prisma.rentalBooking.findMany({ where: own, orderBy: { id: "asc" } }),
      prisma.cruise.findMany({
        where: own,
        include: { ship: { select: { name: true } } },
        orderBy: { id: "asc" },
      }),
      prisma.lodgingStay.findMany({
        where: own,
        include: { lodging: true },
        orderBy: { id: "asc" },
      }),
      prisma.placeVisit.findMany({
        where: { userId, tripId },
        include: { place: true },
        orderBy: { id: "asc" },
      }),
      tripId
        ? prisma.tripJournalEntry.findMany({ where: { tripId }, orderBy: { id: "asc" } })
        : Promise.resolve([]),
    ]);

  const facts = await airportFactsFor(
    flights.map((f) => ({ depIata: f.depIata, arrIata: f.arrIata }))
  );
  const items: RawEntry[] = [];
  const points: MapPoint[] = [];
  const legs: Array<[MapPoint, MapPoint]> = [];
  const leg = (a: MapPoint | null, b: MapPoint | null): void => {
    if (a) points.push(a);
    if (b) points.push(b);
    if (a && b) legs.push([a, b]);
  };
  const push = (dbId: string, entry: BookEntry): void => {
    items.push({ dbId, entry });
  };

  for (const f of flights) {
    const depZone = f.depTimezone ?? facts.get(f.depIata ?? "")?.timezone ?? null;
    const arrZone = f.arrTimezone ?? facts.get(f.arrIata ?? "")?.timezone ?? null;
    const dep = f.depIata ?? f.depIcao ?? "?";
    const arr = f.arrIata ?? f.arrIcao ?? "?";
    // A year- or month-precision flight is stored as the 1st of the period at 00:00 UTC; converting
    // that placeholder through the zone would put a 2015 flight into December 2014.
    const partial = f.departureTime
      ? partialOf(f.departureTime, f.depTimeSemantics, f.depPrecision)
      : null;
    const when = partial
      ? { day: null, time: null, ms: null }
      : stampOf(f.departureTime, depZone, f.depTimeSemantics, f.depPrecision);
    push(
      f.id,
      base("flight", f.id, when, join([f.flightNumber, `${dep} → ${arr}`]), {
        partial,
        detail: [
          join([f.airline, f.aircraft], " · "),
          join([f.depName, f.arrName], " → "),
          span(when.time, clock(f.arrivalTime, arrZone, f.arrTimeSemantics, f.arrPrecision)) ?? "",
        ].filter(Boolean),
        notes: f.notes,
      })
    );
    leg(point(f.depLat, f.depLon, f.depName ?? dep), point(f.arrLat, f.arrLon, f.arrName ?? arr));
  }

  for (const r of rails) {
    const when = stampOf(r.departureTime, r.depTimezone, null, r.depPrecision);
    push(
      r.id,
      base(
        "rail",
        r.id,
        when,
        join(
          [join([r.trainCategory, r.trainNumber]), `${r.depStationName} → ${r.arrStationName}`],
          " · "
        ),
        {
          detail: [
            r.operator ?? "",
            span(when.time, clock(r.arrivalTime, r.arrTimezone, null, r.arrPrecision)) ?? "",
          ].filter(Boolean),
          notes: r.notes,
        }
      )
    );
    leg(point(r.depLat, r.depLon, r.depStationName), point(r.arrLat, r.arrLon, r.arrStationName));
  }

  for (const b of buses) {
    const when = stampOf(b.departureTime, b.depTimezone, null, b.depPrecision);
    push(
      b.id,
      base(
        "bus",
        b.id,
        when,
        join([b.lineName, `${b.depStationName} → ${b.arrStationName}`], " · "),
        {
          detail: [
            b.operator ?? "",
            span(when.time, clock(b.arrivalTime, b.arrTimezone, null, b.arrPrecision)) ?? "",
          ].filter(Boolean),
          notes: b.notes,
        }
      )
    );
    leg(point(b.depLat, b.depLon, b.depStationName), point(b.arrLat, b.arrLon, b.arrStationName));
  }

  for (const f of ferries) {
    const when = stampOf(f.departureTime, f.depTimezone, null, f.depPrecision);
    push(
      f.id,
      base(
        "ferry",
        f.id,
        when,
        join([f.vesselName, `${f.depStationName} → ${f.arrStationName}`], " · "),
        {
          detail: [
            f.operator ?? "",
            span(when.time, clock(f.arrivalTime, f.arrTimezone, null, f.arrPrecision)) ?? "",
          ].filter(Boolean),
          notes: f.notes,
        }
      )
    );
    leg(point(f.depLat, f.depLon, f.depStationName), point(f.arrLat, f.arrLon, f.arrStationName));
  }

  for (const r of rentals) {
    const when = stampOf(r.pickupTime, r.pickupTimezone, null, r.pickupPrecision);
    const back = stampOf(r.returnTime, r.returnTimezone, null, r.returnPrecision);
    push(
      r.id,
      base("rental", r.id, when, join([r.provider, r.vehicleClass], " · "), {
        endDay: back.day,
        detail: [`${r.pickupStationName} → ${r.returnStationName}`],
        notes: r.notes,
      })
    );
    leg(
      point(r.pickupLat, r.pickupLon, r.pickupStationName),
      point(r.returnLat, r.returnLon, r.returnStationName)
    );
  }

  for (const c of cruises) {
    const day = c.startDay ?? c.startDate;
    const end = c.endDay ?? c.endDate;
    push(
      c.id,
      base(
        "cruise",
        c.id,
        { day: day ? isoDay(day) : null, time: null, ms: day ? day.getTime() : null },
        join([c.shipNameOverride ?? c.ship?.name, c.routeName], " · ") || (c.cruiseLine ?? ""),
        {
          endDay: end ? isoDay(end) : null,
          detail: c.cruiseLine ? [c.cruiseLine] : [],
          notes: c.notes,
        }
      )
    );
  }

  for (const st of stays) {
    const day = st.checkInDate ?? st.checkIn;
    const end = st.checkOutDate ?? st.checkOut;
    const l = st.lodging;
    // Only a DAY-precise stay has a day. A stay known to the month or the year is
    // shown as unknown with the part that IS known, never as an exact date.
    const exact = st.datePrecision === "DAY" && day !== null;
    const partial =
      !exact && day && st.datePrecision === "MONTH"
        ? isoDay(day).slice(0, 7)
        : !exact && day && st.datePrecision === "YEAR"
          ? isoDay(day).slice(0, 4)
          : "";
    push(
      st.id,
      base(
        "stay",
        st.id,
        exact && day
          ? { day: isoDay(day), time: null, ms: day.getTime() }
          : { day: null, time: null, ms: null },
        l.name,
        {
          partial: partial || null,
          endDay: exact && end ? isoDay(end) : null,
          detail: [
            join([l.city, l.country], ", "),
            st.nights != null ? `${st.nights} ${s.nights}` : "",
            partial ? `${s.partialDate} ${partial}` : "",
          ].filter(Boolean),
          notes: st.notes,
        }
      )
    );
    const p = point(l.lat, l.lon, l.name);
    if (p) points.push(p);
  }

  for (const v of visits) {
    const zone = v.visitedZone;
    // `visitedAt` is the web's wall clock as fake UTC; the true instant is `visitedAtUtc`.
    const when =
      v.visitedAtUtc && zone && isValidZone(zone)
        ? whenOf(v.visitedAtUtc, zone)
        : {
            day: v.visitedAt ? isoDay(v.visitedAt) : null,
            time: null,
            ms: v.visitedAt?.getTime() ?? null,
          };
    if (v.visitedPrecision === "day") when.time = null;
    push(
      v.id,
      base("visit", v.id, when, v.place.name, {
        detail: [join([v.place.city, v.place.country], ", ")].filter(Boolean),
        notes: v.notes,
      })
    );
    const p = point(v.place.lat, v.place.lon, v.place.name);
    if (p) points.push(p);
  }

  for (const j of journal) {
    const day = j.day ?? j.date;
    push(
      j.id,
      base("journal", j.id, { day: isoDay(day), time: null, ms: day.getTime() }, j.title ?? "", {
        notes: j.body,
      })
    );
  }

  return {
    items,
    points,
    legs,
    flights: flights.map((f) => ({ depIata: f.depIata, arrIata: f.arrIata })),
  };
}
