import type { AnnotationSelection } from "../annotations";
import { select } from "./workshopSamples";

/**
 * Invented rental confirmations for the rental workshop (forgejo#309). Every
 * provider, station, number, price and date is made up. SOURCE is annotated,
 * HELD_OUT the same provider's next booking the derivation never saw (and
 * one that prints no return clock), FOREIGN another provider's.
 */

export const RENTAL_SUBJECT = "Ihre Reservierung bei Mietwagenfern";

const rentalDoc = (opts: {
  ref: string;
  vehicle: string;
  pickup: { station: string; date: string; time?: string };
  dropoff: { station: string; date: string; time?: string };
  price: string;
}): string =>
  [
    "Mietwagenfern GmbH · Probeallee 4 · 60311 Musterfurt",
    "Ihre Reservierung ist bestätigt",
    "",
    `Reservierungsnummer: ${opts.ref}`,
    `Fahrzeugklasse: ${opts.vehicle}`,
    "",
    `Abholstation: ${opts.pickup.station}`,
    `Abholdatum: ${opts.pickup.date}`,
    ...(opts.pickup.time ? [`Abholzeit: ${opts.pickup.time}`] : []),
    "",
    `Rückgabestation: ${opts.dropoff.station}`,
    `Rückgabedatum: ${opts.dropoff.date}`,
    ...(opts.dropoff.time ? [`Rückgabezeit: ${opts.dropoff.time}`] : []),
    "",
    `Gesamtpreis: ${opts.price} EUR`,
  ].join("\n");

export const RENTAL_SOURCE = rentalDoc({
  ref: "MF-778812",
  vehicle: "Kompaktklasse",
  pickup: { station: "Musterfurt Flughafen Terminal 2", date: "14.11.2027", time: "10:30" },
  dropoff: { station: "Musterfurt Hauptbahnhof", date: "21.11.2027", time: "09:00" },
  price: "312,50",
});

export const RENTAL_HELD_OUT = rentalDoc({
  ref: "MF-903311",
  vehicle: "Mittelklasse Kombi",
  pickup: { station: "Probestadt Innenstadt", date: "02.02.2028", time: "08:00" },
  dropoff: { station: "Probestadt Innenstadt", date: "06.02.2028" },
  price: "198,00",
});

export const RENTAL_FOREIGN = [
  "Autoverleih Fremdling · Am Ring 2 · 04109 Anderswo",
  "Buchungsbestätigung",
  "Buchung: AF-1234567",
  "Abholung: Anderswo Hbf, 01.03.2028 12:00",
  "Rückgabe: Anderswo Hbf, 03.03.2028 12:00",
].join("\n");

export const RENTAL_SELECTIONS: AnnotationSelection[] = [
  select(RENTAL_SOURCE, "Mietwagenfern GmbH", "provider"),
  select(RENTAL_SOURCE, "MF-778812", "confirmationNumber"),
  select(RENTAL_SOURCE, "Kompaktklasse", "vehicleClass"),
  select(RENTAL_SOURCE, "Musterfurt Flughafen Terminal 2", "pickupStation"),
  select(RENTAL_SOURCE, "14.11.2027", "pickupDate"),
  select(RENTAL_SOURCE, "10:30", "pickupTime"),
  select(RENTAL_SOURCE, "Musterfurt Hauptbahnhof", "returnStation"),
  select(RENTAL_SOURCE, "21.11.2027", "returnDate"),
  select(RENTAL_SOURCE, "09:00", "returnTime"),
  select(RENTAL_SOURCE, "312,50", "price"),
];
