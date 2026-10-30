/** Project existing records into read-only anchors without changing travel evidence. */
import { isActualRecordDone } from "../../shared/actualRecordDone";
import { bookingDuration } from "./temporal";
import { randomUUID } from "node:crypto";
import type { PlanTransaction } from "./execution";
import { bookingSchema } from "./schema";
import { parseState } from "./upgrade";
import type { PlanState, PlanKind, PlanBooking } from "./types";
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const day = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : null;
function timing(value: unknown, zone: unknown, semantics: unknown, precision: unknown) {
  if (!(value instanceof Date) || precision === "unknown" || semantics === "UNKNOWN")
    return { day: null, time: null };
  if (semantics === "DATE_ONLY" || precision === "day") return { day: day(value), time: null };
  if (semantics === "LEGACY_FAKE_UTC")
    return { day: day(value), time: value.toISOString().slice(11, 16) };
  if (!str(zone)) return { day: null, time: null };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: str(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const p = (type: string) => parts.find((x) => x.type === type)?.value;
  return { day: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour")}:${p("minute")}` };
}
export async function adoptExisting(
  tx: PlanTransaction,
  userId: string,
  tripId: string,
  input: PlanState
): Promise<PlanState> {
  const trip = await tx.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      bookings: { where: { userId } },
      flights: { where: { userId } },
      lodgingStays: { where: { userId, lodging: { userId } }, include: { lodging: true } },
      railJourneys: { where: { userId } },
      busJourneys: { where: { userId } },
      ferryJourneys: { where: { userId } },
      cruises: { where: { userId }, include: { ship: true } },
      rentalBookings: { where: { userId } },
    },
  });
  if (!trip) return input;
  const state = structuredClone(input);
  const groups = new Map(trip.bookings.map((b) => [b.id, b]));
  const project = (kind: PlanKind, records: unknown[]) => {
    for (const raw of records) {
      const r = raw as Row,
        id = str(r.id),
        existing = state.items.find((i) => i.source?.id === id);
      // A plan-created record stays owned by its original plan item.
      if (str(r.externalRef).startsWith("travplan:")) continue;
      const lodging = r.lodging as Row | undefined,
        ship = r.ship as Row | undefined;
      const zone = r.depTimezone ?? r.stayZone ?? r.startZone ?? r.pickupTimezone ?? null;
      const arrivalZone = r.arrTimezone ?? r.endZone ?? r.returnTimezone ?? null;
      const dep = timing(
        r.departureTime ?? r.pickupTime,
        zone,
        r.depTimeSemantics,
        r.depPrecision ?? r.pickupPrecision
      );
      const arr = timing(
        r.arrivalTime ?? r.returnTime,
        arrivalZone,
        r.arrTimeSemantics,
        r.arrPrecision ?? r.returnPrecision
      );
      const bookingId = str(r.bookingId),
        group = groups.get(bookingId);
      const completed = isActualRecordDone(str(r.status));
      const source = {
        kind: (completed ? "linkedActual:" : "existing:") + kind,
        id,
        version: (r.updatedAt as Date).toISOString(),
        ...(lodging
          ? { auxId: str(lodging.id), auxVersion: (lodging.updatedAt as Date).toISOString() }
          : {}),
      };
      const draft: PlanBooking = bookingSchema.parse({
        id: existing?.bookingId ?? randomUUID(),
        actualBookingId: group?.id ?? null,
        priceGroupId: group?.id ?? null,
        kind,
        title:
          str(r.flightNumber) ||
          str(lodging?.name) ||
          str(r.trainNumber) ||
          str(r.provider) ||
          str(ship?.name) ||
          str(r.routeName) ||
          [
            str(r.depStationName ?? r.depStopName ?? r.depPortName),
            str(r.arrStationName ?? r.arrStopName ?? r.arrPortName),
          ]
            .filter(Boolean)
            .join(" → ") ||
          kind,
        reference: str(r.bookingReference ?? r.confirmationNumber ?? group?.pnr) || null,
        provider: str(r.airline ?? r.operator ?? r.provider ?? r.cruiseLine),
        day:
          kind === "hotel"
            ? r.datePrecision === "DAY"
              ? day(r.checkInDate ?? r.checkIn)
              : null
            : kind === "cruise"
              ? day(r.startDay ?? r.startDate)
              : dep.day,
        endDay:
          kind === "hotel"
            ? r.datePrecision === "DAY"
              ? day(r.checkOutDate ?? r.checkOut)
              : null
            : kind === "cruise"
              ? day(r.endDay ?? r.endDate)
              : kind === "rental"
                ? arr.day
                : null,
        time: kind === "hotel" ? str(r.checkInTime) || null : dep.time,
        timezone: zone,
        arrivalDay: arr.day,
        arrivalTime: arr.time,
        arrivalTimezone: arrivalZone,
        originPlace: str(
          r.depIata ?? r.depStationName ?? r.depStopName ?? r.depPortName ?? r.pickupStationName
        ),
        place: str(
          lodging?.city ??
            r.arrIata ??
            r.arrStationName ??
            r.arrStopName ??
            r.arrPortName ??
            r.returnStationName
        ),
        amount: group?.price ?? r.totalPrice ?? r.price ?? r.estimatedTotal ?? null,
        paid: 0,
        currency: group?.currency ?? r.currency ?? state.currency,
        city: str(lodging?.city),
        country: str(lodging?.country),
        address: str(lodging?.address),
        documentIds: [],
        source: "existing",
        details: { flightNumber: r.flightNumber ?? null },
      });
      if (existing) {
        // An explicit refresh updates only the source projection, preserving user annotations.
        if (
          !existing.source?.kind.startsWith("existing:") &&
          !existing.source?.kind.startsWith("linkedActual:")
        )
          continue;
        Object.assign(existing, {
          title: draft.title,
          day: draft.day,
          time: draft.time,
          timezone: draft.timezone,
          place: draft.place,
          source,
          execution: completed ? "confirmed" : "unconfirmed",
        });
        const previous = state.bookings.findIndex((b) => b.id === draft.id);
        if (previous >= 0)
          state.bookings[previous] = {
            ...draft,
            documentIds: state.bookings[previous].documentIds,
          };
      } else {
        state.bookings.push(draft);
        state.items.push({
          id: randomUUID(),
          title: draft.title,
          kind,
          day: draft.day,
          time: draft.time,
          duration: bookingDuration(draft),
          timezone: draft.timezone,
          place: draft.place,
          note: "",
          booked: true,
          bookingId: draft.id,
          stationId: null,
          execution: completed
            ? "confirmed"
            : str(r.status) === "cancelled"
              ? "cancelled"
              : "unconfirmed",
          source,
        });
      }
    }
  };
  project("flight", trip.flights);
  project("hotel", trip.lodgingStays);
  project("rail", trip.railJourneys);
  project("bus", trip.busJourneys);
  project("ferry", trip.ferryJourneys);
  project("cruise", trip.cruises);
  project("rental", trip.rentalBookings);
  return parseState(state);
}
