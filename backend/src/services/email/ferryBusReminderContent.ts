import type { TimeValue } from "../../shared/time/wire";
import type { MailContent, MailFact } from "./mailShell";
import { formatHoursUntil, formatTimeValue, type ReminderLang } from "./reminderFormat";
import { assemble, fact, isZoned, joined, present, type ReminderLinks } from "./reminderContent";

/**
 * The ferry and bus reminder mails — rail's mail for a single train, with
 * each domain's own facts. Kept beside `reminderContent.ts` rather than in it
 * so that file stays well under the 800-line ratchet; the shell helpers it
 * exports (`assemble`, `fact`, …) are the same ones every other builder uses.
 *
 * Neither domain groups legs into a ride (no booking-wide rule like
 * `groupRailLegs` exists for them), so one crossing or one coach ride is one
 * mail, named by where it ends — as rail's subject is since 2026-10-06.
 * Every vocabulary here (fare class, cabin, vehicle) is the operator's own
 * free text, so it is printed as stored, never worded.
 */

// ─── Ferry ──────────────────────────────────────────────────────────────────

export interface FerryReminderData {
  id: string;
  tripId: string | null;
  operator: string | null;
  vesselName: string | null;
  fareClass: string | null;
  cabinType: string | null;
  seat: string | null;
  vehicleType: string | null;
  vehicleRegistration: string | null;
  bookingReference: string | null;
  ticketReference: string | null;
  depStationName: string;
  arrStationName: string;
  departure: TimeValue;
  arrival: TimeValue | null;
}

export function ferryReminderContent(
  crossing: FerryReminderData,
  hoursUntilDeparture: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const until = formatHoursUntil(hoursUntilDeparture, lang);

  const rows: MailFact[] = [];
  fact(rows, de ? "Schiff" : "Vessel", crossing.vesselName);
  fact(rows, de ? "Reederei" : "Operator", crossing.operator);
  fact(rows, de ? "Klasse" : "Class", crossing.fareClass);
  fact(rows, de ? "Kabine" : "Cabin", crossing.cabinType);
  fact(rows, de ? "Platz" : "Seat", crossing.seat, true);
  fact(
    rows,
    de ? "Fahrzeug" : "Vehicle",
    joined([crossing.vehicleType, crossing.vehicleRegistration], " · ")
  );
  fact(rows, de ? "Buchungscode" : "Booking reference", crossing.bookingReference, true);
  // The ticket number is a second code only when it differs from the booking's.
  if (present(crossing.ticketReference) !== present(crossing.bookingReference)) {
    fact(rows, "Ticket", crossing.ticketReference, true);
  }

  return assemble("ferry", lang, links, {
    subject: de
      ? `Fähr-Erinnerung: Deine Überfahrt nach ${crossing.arrStationName} in ${hoursUntilDeparture}h`
      : `Ferry reminder: your crossing to ${crossing.arrStationName} in ${hoursUntilDeparture}h`,
    heading: de
      ? `Deine Überfahrt nach ${crossing.arrStationName} startet ${until}`
      : `Your crossing to ${crossing.arrStationName} leaves ${until}`,
    blocks: [
      {
        kind: "route",
        from: { primary: crossing.depStationName, time: formatTimeValue(crossing.departure, lang) },
        to: { primary: crossing.arrStationName, time: formatTimeValue(crossing.arrival, lang) },
      },
      { kind: "facts", rows },
    ],
    path: crossing.tripId ? `trips/${crossing.tripId}` : `ferry/${crossing.id}`,
    zoned: isZoned(crossing.departure) || isZoned(crossing.arrival),
  });
}

// ─── Bus ────────────────────────────────────────────────────────────────────

export interface BusReminderData {
  id: string;
  tripId: string | null;
  operator: string | null;
  lineName: string | null;
  fareClass: string | null;
  seat: string | null;
  bookingReference: string | null;
  depStationName: string;
  arrStationName: string;
  departure: TimeValue;
  arrival: TimeValue | null;
}

export function busReminderContent(
  ride: BusReminderData,
  hoursUntilDeparture: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const until = formatHoursUntil(hoursUntilDeparture, lang);

  const rows: MailFact[] = [];
  fact(rows, de ? "Linie" : "Line", ride.lineName, true);
  fact(rows, de ? "Betreiber" : "Operator", ride.operator);
  fact(rows, de ? "Tarif" : "Fare", ride.fareClass);
  fact(rows, de ? "Platz" : "Seat", ride.seat, true);
  fact(rows, de ? "Buchungscode" : "Booking reference", ride.bookingReference, true);

  return assemble("bus", lang, links, {
    subject: de
      ? `Bus-Erinnerung: Deine Fahrt nach ${ride.arrStationName} in ${hoursUntilDeparture}h`
      : `Bus reminder: your journey to ${ride.arrStationName} in ${hoursUntilDeparture}h`,
    heading: de
      ? `Deine Fahrt nach ${ride.arrStationName} startet ${until}`
      : `Your journey to ${ride.arrStationName} leaves ${until}`,
    blocks: [
      {
        kind: "route",
        from: { primary: ride.depStationName, time: formatTimeValue(ride.departure, lang) },
        to: { primary: ride.arrStationName, time: formatTimeValue(ride.arrival, lang) },
      },
      { kind: "facts", rows },
    ],
    path: ride.tripId ? `trips/${ride.tripId}` : `bus/${ride.id}`,
    zoned: isZoned(ride.departure) || isZoned(ride.arrival),
  });
}
