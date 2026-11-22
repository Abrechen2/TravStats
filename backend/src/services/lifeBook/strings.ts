import type { BookLang, DocKind, EntryKind } from "./types";

/** The book's own copy. It follows the web UI language chosen for the export. */
interface BookStrings {
  bookTitle: string;
  subtitle: string;
  contents: string;
  generated: string;
  by: string;
  trips: string;
  unknownDate: string;
  unknownDates: string;
  noTrip: string;
  countries: string;
  travellers: string;
  period: string;
  periodUnknown: string;
  evidence: string;
  dayN: string;
  until: string;
  mapTitle: string;
  mapNote: string;
  mapMore: string;
  photos: string;
  notes: string;
  scopeAll: string;
  scopeYear: string;
  scopeTrip: string;
  entryKinds: Record<EntryKind, string>;
  docKinds: Record<DocKind, string>;
  nights: string;
  cancelled: string;
  footer: string;
}

const de: BookStrings = {
  bookTitle: "Lebensbuch",
  subtitle: "Eine Chronik des Reisetagebuchs",
  contents: "Inhalt",
  generated: "Erstellt am",
  by: "Reisetagebuch von",
  trips: "Reisen",
  unknownDate: "Datum unbekannt",
  unknownDates: "Ohne bekanntes Datum",
  noTrip: "Einträge ohne Reise",
  countries: "Länder",
  travellers: "Reisende",
  period: "Zeitraum",
  periodUnknown: "unbekannt",
  evidence: "Beleg",
  dayN: "Tag",
  until: "bis",
  mapTitle: "Routenkarte",
  mapNote:
    "Schematische Karte ohne Kartenhintergrund, nur die Koordinaten der Reise. Die Liste darunter nennt die Orte.",
  mapMore: "weitere Orte nicht aufgeführt",
  photos: "Fotos",
  notes: "Notizen",
  scopeAll: "Alles",
  scopeYear: "Jahr",
  scopeTrip: "Reise",
  entryKinds: {
    flight: "Flug",
    rail: "Bahn",
    bus: "Bus",
    ferry: "Fähre",
    rental: "Mietwagen",
    cruise: "Kreuzfahrt",
    stay: "Unterkunft",
    visit: "Ort",
    journal: "Tagebuch",
  },
  docKinds: {
    invoice: "Rechnung",
    booking: "Buchung",
    boardingPass: "Bordkarte",
    ticket: "Ticket",
    other: "Dokument",
  },
  nights: "Nächte",
  cancelled: "storniert",
  footer: "Diese Datei ist in sich geschlossen: sie braucht weder TravStats noch Internet.",
};

const en: BookStrings = {
  bookTitle: "Life book",
  subtitle: "A chronicle of the travel log",
  contents: "Contents",
  generated: "Created on",
  by: "Travel log of",
  trips: "Trips",
  unknownDate: "Date unknown",
  unknownDates: "No known date",
  noTrip: "Entries without a trip",
  countries: "Countries",
  travellers: "Travellers",
  period: "Period",
  periodUnknown: "unknown",
  evidence: "Evidence",
  dayN: "Day",
  until: "until",
  mapTitle: "Route map",
  mapNote:
    "Schematic map without a map background, only the trip's coordinates. The list below names the places.",
  mapMore: "more places not listed",
  photos: "Photos",
  notes: "Notes",
  scopeAll: "Everything",
  scopeYear: "Year",
  scopeTrip: "Trip",
  entryKinds: {
    flight: "Flight",
    rail: "Rail",
    bus: "Bus",
    ferry: "Ferry",
    rental: "Car rental",
    cruise: "Cruise",
    stay: "Stay",
    visit: "Place",
    journal: "Journal",
  },
  docKinds: {
    invoice: "Invoice",
    booking: "Booking",
    boardingPass: "Boarding pass",
    ticket: "Ticket",
    other: "Document",
  },
  nights: "nights",
  cancelled: "cancelled",
  footer: "This file is self-contained: it needs neither TravStats nor the internet.",
};

export function bookStrings(lang: BookLang): BookStrings {
  return lang === "en" ? en : de;
}
