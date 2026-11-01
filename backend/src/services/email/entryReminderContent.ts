import type { LocalDateValue, TimeValue } from "../../shared/time/wire";
import type { MailContent, MailFact } from "./mailShell";
import {
  formatHoursUntil,
  formatLocalDate,
  formatTimeValue,
  type ReminderLang,
} from "./reminderFormat";
import { assemble, fact, isZoned, joined, present, type ReminderLinks } from "./reminderContent";

/**
 * The rental, roadtrip-station and place-visit reminder mails (forgejo#405).
 * Beside `reminderContent.ts` for the same reason as `ferryBusReminderContent`:
 * that file stays under the size ratchet and the shell helpers are shared.
 *
 * Every time is a `TimeValue` / `LocalDateValue` already on the place's own
 * clock; a fact the entry does not carry is left out by `fact()`.
 */

// ─── Rental ─────────────────────────────────────────────────────────────────

export interface RentalReminderData {
  id: string;
  tripId: string | null;
  /** Which hand-over this mail announces. */
  part: "pickup" | "return";
  provider: string;
  confirmationNumber: string | null;
  vehicleClass: string | null;
  vehicleExample: string | null;
  licensePlate: string | null;
  pickupStationName: string;
  pickupAddress: string | null;
  returnStationName: string;
  returnAddress: string | null;
  pickup: TimeValue | null;
  return: TimeValue | null;
}

export function rentalReminderContent(
  rental: RentalReminderData,
  hoursUntil: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const until = formatHoursUntil(hoursUntil, lang);
  const pickingUp = rental.part === "pickup";
  const station = pickingUp ? rental.pickupStationName : rental.returnStationName;
  const address = pickingUp ? rental.pickupAddress : rental.returnAddress;

  const rows: MailFact[] = [];
  fact(rows, de ? "Station" : "Station", station);
  fact(rows, de ? "Adresse" : "Address", address);
  fact(rows, de ? "Anbieter" : "Company", rental.provider);
  fact(
    rows,
    de ? "Fahrzeug" : "Vehicle",
    joined([rental.vehicleClass, rental.vehicleExample], " · ")
  );
  fact(rows, de ? "Kennzeichen" : "Licence plate", rental.licensePlate, true);
  fact(rows, de ? "Abholung" : "Pick-up", formatTimeValue(rental.pickup, lang));
  fact(rows, de ? "Rückgabe" : "Return", formatTimeValue(rental.return, lang));
  fact(rows, de ? "Buchungscode" : "Booking reference", rental.confirmationNumber, true);

  return assemble("rental", lang, links, {
    subject: pickingUp
      ? de
        ? `Mietwagen-Erinnerung: Abholung bei ${station} in ${hoursUntil}h`
        : `Rental reminder: pick-up at ${station} in ${hoursUntil}h`
      : de
        ? `Mietwagen-Erinnerung: Rückgabe bei ${station} in ${hoursUntil}h`
        : `Rental reminder: return at ${station} in ${hoursUntil}h`,
    heading: pickingUp
      ? de
        ? `Deine Abholung bei ${station} ist ${until}`
        : `Your pick-up at ${station} is ${until}`
      : de
        ? `Deine Rückgabe bei ${station} ist ${until}`
        : `Your return at ${station} is ${until}`,
    blocks: [{ kind: "facts", rows }],
    path: rental.tripId ? `trips/${rental.tripId}` : `rentals/${rental.id}`,
    zoned: isZoned(rental.pickup) || isZoned(rental.return),
  });
}

// ─── Roadtrip station ───────────────────────────────────────────────────────

export interface RoadtripStationReminderData {
  id: string;
  tripId: string | null;
  roadtripId: string;
  roadtripName: string;
  stationName: string;
  /** The stay slept in here, when the station is one. */
  stayName: string | null;
  arrivalDay: LocalDateValue | null;
  nights: number | null;
}

export function roadtripStationReminderContent(
  station: RoadtripStationReminderData,
  hoursUntil: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const until = formatHoursUntil(hoursUntil, lang);

  const rows: MailFact[] = [];
  fact(rows, "Roadtrip", station.roadtripName);
  fact(rows, de ? "Station" : "Stop", station.stationName);
  fact(rows, de ? "Unterkunft" : "Stay", station.stayName);
  fact(rows, de ? "Ankunft" : "Arrival", formatLocalDate(station.arrivalDay?.date, lang));
  fact(rows, de ? "Nächte" : "Nights", station.nights);

  return assemble("roadtrip", lang, links, {
    subject: de
      ? `Roadtrip-Erinnerung: ${station.stationName} in ${hoursUntil}h`
      : `Roadtrip reminder: ${station.stationName} in ${hoursUntil}h`,
    heading: de
      ? `Nächste Station: ${station.stationName}, ${until}`
      : `Next stop: ${station.stationName}, ${until}`,
    blocks: [{ kind: "facts", rows }],
    path: `roadtrips/${station.roadtripId}`,
    // A station carries a day, never a clock: nothing here is a local time.
    zoned: false,
  });
}

// ─── Place visit ────────────────────────────────────────────────────────────

export interface PlaceVisitReminderData {
  id: string;
  tripId: string | null;
  placeId: string;
  placeName: string;
  address: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  visitAt: TimeValue;
}

export function placeVisitReminderContent(
  visit: PlaceVisitReminderData,
  hoursUntil: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const until = formatHoursUntil(hoursUntil, lang);

  const rows: MailFact[] = [];
  fact(rows, de ? "Ort" : "Place", visit.placeName);
  fact(rows, de ? "Adresse" : "Address", visit.address);
  fact(rows, de ? "Stadt" : "City", joined([visit.city, visit.country], ", "));
  fact(rows, de ? "Zeit" : "Time", formatTimeValue(visit.visitAt, lang));
  fact(rows, de ? "Notiz" : "Note", present(visit.notes));

  return assemble("poi", lang, links, {
    subject: de
      ? `Erinnerung: Besuch von ${visit.placeName} in ${hoursUntil}h`
      : `Reminder: visiting ${visit.placeName} in ${hoursUntil}h`,
    heading: de
      ? `Dein Besuch bei ${visit.placeName} ist ${until}`
      : `Your visit to ${visit.placeName} is ${until}`,
    blocks: [{ kind: "facts", rows }],
    path: visit.tripId ? `trips/${visit.tripId}` : `places/${visit.placeId}`,
    zoned: isZoned(visit.visitAt),
  });
}
