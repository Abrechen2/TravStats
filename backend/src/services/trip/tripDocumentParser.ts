/**
 * Reads a package-tour operator's travel documents.
 *
 * Written against Berge & Meer's PDFs, which is what the owner's inbox holds.
 * They are machine-generated and strikingly regular, so this is a TEMPLATE —
 * measurable against real files, with no model in the loop and no guessing.
 *
 * The first thing to know: the MAIL says nothing. Every one of these is a
 * cover letter ("anbei erhalten Sie Ihre Reiseunterlagen als PDF-Datei"). The
 * itinerary lives in the attachment, so a parser that reads mail text finds
 * exactly nothing here.
 *
 * Two documents arrive for the same trip, and they carry different halves:
 *
 *   Rechnung        — the trip's NAME, its day, who travelled, the total, and
 *                     the flights as IATA codes with airline and number.
 *   Reiseunterlagen — the day-by-day itinerary, and the HOTELS with their
 *                     dates, addresses and phone numbers.
 *
 * They share a booking number, which is what lets the second one be recognised
 * as belonging to the first rather than starting a new trip.
 */

export type TripDocumentKind = "invoice" | "itinerary" | "unknown";

export interface TripFlightRow {
  /** `dd.mm.yy` as it stood in the document, normalised to ISO below. */
  date: string;
  from: string;
  to: string;
  /** Present on the invoice (IATA), absent on the itinerary (city names). */
  fromIata?: string;
  toIata?: string;
  airline?: string;
  flightNumber?: string;
  departTime?: string;
  arriveTime?: string;
  /** Arrival falls on a later day (`07:15+1`). */
  arrivesNextDay?: boolean;
  /**
   * Why this row is not a flight anyone took, when it isn't one:
   *  - `placeholder`: `00:00 Uhr - 00:01 Uhr XX XXX`, a domestic leg the
   *    operator books but does not ticket. Times and number are filler.
   *  - `separate-ticket`: `sep. Ticket*`, flown but ticketed elsewhere, so
   *    there is no number and no time here at all.
   *  - `train`: "Zug zum Flug", the rail transfer to the airport.
   */
  ignore?: "placeholder" | "separate-ticket" | "train";
}

export interface TripStayRow {
  from: string;
  to: string;
  name: string;
  addressLines: string[];
  city: string | null;
  country: string | null;
  phone: string | null;
  website: string | null;
}

export interface TripDocument {
  kind: TripDocumentKind;
  bookingReference: string | null;
  tripCode: string | null;
  tripName: string | null;
  /** First day of travel, ISO. */
  startDate: string | null;
  travellers: string[];
  totalPrice: number | null;
  currency: string | null;
  flights: TripFlightRow[];
  stays: TripStayRow[];
  /** Country names the itinerary attributes to the hotel blocks. */
  countries: string[];
}

const DATE = String.raw`(\d{2}\.\d{2}\.\d{2})`;
const TIME = String.raw`(\d{1,2}:\d{2})`;

/**
 * `dd.mm.yy` or `dd.mm.yyyy` → ISO. Both spellings occur, and in the SAME
 * document: the tables use two-digit years, the header line "Reisedatum
 * 15.11.2024" uses four. Reading only two digits there turned a 2024 trip
 * into 2020 — a wrong number that looked entirely plausible on screen.
 */
export function toIsoDate(german: string): string | null {
  const m = german.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 4 ? m[3] : `20${m[3]}`;
  return `${year}-${m[2]}-${m[1]}`;
}

function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim());
}

export function classifyTripDocument(text: string): TripDocumentKind {
  if (/^Ihr Reiseablauf$/m.test(text) || /Details zu Ihren Unterkünften/.test(text)) {
    return "itinerary";
  }
  if (/IHRE FLUGSTRECKE|Gesamtbetrag/.test(text)) return "invoice";
  return "unknown";
}

function firstMatch(all: string[], re: RegExp): string | null {
  for (const line of all) {
    const m = line.match(re);
    if (m) return (m[1] ?? "").trim() || null;
  }
  return null;
}

/**
 * `Gesamtbetrag 6.879,00 EUR` — German thousands and decimal separators. A
 * naive `parseFloat` reads that as 6.879 and understates the trip by three
 * orders of magnitude, which is exactly the kind of wrong number that looks
 * plausible on a screen.
 */
function parseGermanAmount(raw: string): number | null {
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseInvoiceFlights(all: string[]): TripFlightRow[] {
  const header = all.findIndex((l) => /^VON - NACH AIRLINE FLUGNR/.test(l));
  if (header === -1) return [];
  const rows: TripFlightRow[] = [];
  const re = new RegExp(
    String.raw`^([A-Z]{3}) - ([A-Z]{3}) ([A-Z0-9]{2}) ?(\d{1,4}) ${DATE} ${TIME} ${TIME}(\+\d)?$`,
  );
  for (const line of all.slice(header + 1)) {
    const m = line.match(re);
    if (!m) {
      // The table ends at the first line that is not a flight — a footnote,
      // a page footer. Reading past it would scoop up the letterhead.
      if (line.length > 0 && rows.length > 0) break;
      continue;
    }
    rows.push({
      date: m[5],
      from: m[1],
      to: m[2],
      fromIata: m[1],
      toIata: m[2],
      airline: m[3],
      // Same zero-padding as the itinerary spelling: `MS 042` is MS42.
      flightNumber: `${m[3]}${m[4].replace(/^0+/, "")}`,
      departTime: m[6],
      arriveTime: m[7],
      arrivesNextDay: Boolean(m[8]),
    });
  }
  return rows;
}

function parseItineraryFlights(all: string[]): { flights: TripFlightRow[]; countries: string[] } {
  const start = all.findIndex((l) => /^Ihr Reiseablauf$/.test(l));
  if (start === -1) return { flights: [], countries: [] };

  const flights: TripFlightRow[] = [];
  const countries: string[] = [];
  const flightRe = new RegExp(
    String.raw`^${DATE} (.+?) - (.+?) ${TIME} Uhr - ${TIME}(\+\d)? Uhr ([A-Z0-9]{2}) ?([A-Z0-9]{3,4})$`,
  );
  const sepTicketRe = new RegExp(String.raw`^${DATE} (.+?) - (.+?) sep\. Ticket\*?$`);
  const hotelBlockRe = new RegExp(String.raw`^${DATE} - ${DATE} div\. Rundreisehotels (.+)$`);
  const trainRe = new RegExp(String.raw`^${DATE} Zug zum Flug`);

  for (const line of all.slice(start + 1)) {
    if (/^Ihre Reiseunterlagen$|^Ihre Unterkünfte$/.test(line)) break;

    const hotel = line.match(hotelBlockRe);
    if (hotel) {
      if (!countries.includes(hotel[3])) countries.push(hotel[3]);
      continue;
    }
    if (trainRe.test(line)) {
      flights.push({ date: line.slice(0, 8), from: "", to: "", ignore: "train" });
      continue;
    }
    const sep = line.match(sepTicketRe);
    if (sep) {
      flights.push({ date: sep[1], from: sep[2], to: sep[3], ignore: "separate-ticket" });
      continue;
    }
    const m = line.match(flightRe);
    if (!m) continue;
    const [, date, from, to, depart, arrive, nextDay, airline, number] = m;

    // `00:00 Uhr - 00:01 Uhr XX XXX` is not a flight anyone boarded — it is
    // how the operator writes a leg it arranges but does not ticket. Taken at
    // face value it would put a one-minute flight in the logbook.
    const placeholder = airline === "XX" || (depart === "00:00" && arrive === "00:01");
    flights.push({
      date,
      from,
      to,
      airline: placeholder ? undefined : airline,
      // `QR 0070` is the operator's zero-padded spelling of QR70. Strip the
      // padding back to the airline's own numbering before it becomes a
      // flight number anyone tries to look up.
      flightNumber: placeholder ? undefined : `${airline}${number.replace(/^0+/, "")}`,
      departTime: placeholder ? undefined : depart,
      arriveTime: placeholder ? undefined : arrive,
      arrivesNextDay: placeholder ? undefined : Boolean(nextDay),
      ignore: placeholder ? "placeholder" : undefined,
    });
  }
  return { flights, countries };
}

/**
 * The hotel blocks. Each opens with a date range and a name; the lines below
 * it are the address, ending in a country, sometimes a phone and a website.
 *
 * The name can WRAP — "Thanh Lich Royal Boutique" / "Hotel" — and a wrapped
 * second line is indistinguishable from the first line of a street address by
 * shape alone. The rule used here: a following line joins the name only when
 * it carries no digit and the line after it is not the country, i.e. there is
 * still an address to come. Anything less certain is left in the address,
 * where a human reviewing the preview can see it.
 */
/** The page footer, which is what actually ends a section in these PDFs. */
const END_OF_SECTION = /Seite \d+ von \d+/;
/** Lines that belong to the letterhead rather than to any hotel. */
const BOILERPLATE = /^Berge & Meer Touristik|^Einzelzimmer|^Doppelzimmer|^Zimmerart/;

function parseStays(all: string[]): TripStayRow[] {
  const start = all.findIndex((l) => /^Details zu Ihren Unterkünften/.test(l));
  if (start === -1) return [];

  const blockRe = new RegExp(String.raw`^${DATE} - ${DATE} (.*)$`);
  const stays: TripStayRow[] = [];
  let current: { from: string; to: string; name: string; body: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const body = current.body.filter(Boolean);
    let name = current.name;
    const phoneIdx = body.findIndex((l) => /^Tel\.?:/i.test(l));
    const webIdx = body.findIndex((l) => /^(https?:\/\/|www\.)/i.test(l));
    const tail = body.filter((_l, i) => i !== phoneIdx && i !== webIdx);

    // A wrapped name: first body line with no digits, and something left
    // after it besides the country.
    if (tail.length >= 3 && !/\d/.test(tail[0]) && !/^[A-ZÄÖÜ]/.test(tail[0]) === false) {
      const looksLikeStreet = /\d|str|road|avenue|allee|weg|lot|plot/i.test(tail[0]);
      if (!looksLikeStreet && name.length > 0) {
        name = `${name} ${tail[0]}`.trim();
        tail.shift();
      }
    }

    const country = tail.length > 0 ? tail[tail.length - 1] : null;
    const city = tail.length > 1 ? tail[tail.length - 2] : null;
    stays.push({
      from: current.from,
      to: current.to,
      name,
      addressLines: tail.slice(0, Math.max(0, tail.length - 2)),
      city,
      country,
      phone: phoneIdx >= 0 ? body[phoneIdx].replace(/^Tel\.?:\s*/i, "").trim() : null,
      website: webIdx >= 0 ? body[webIdx] : null,
    });
    current = null;
  };

  for (const line of all.slice(start + 1)) {
    // The section runs to the bottom of its page, and the page FOOTER is what
    // ends it — "A1V010 FRA 15.11.2024 - 1C868387.1 - 1/1 - ECLH Seite 8 von
    // 8". Without this the loop reads straight on into pages 2-8 and the last
    // hotel swallows the baggage rules, the emergency numbers and the whole
    // Zug-zum-Flug leaflet as its street address.
    if (END_OF_SECTION.test(line)) break;
    if (BOILERPLATE.test(line)) continue;
    const m = line.match(blockRe);
    if (m) {
      flush();
      current = { from: m[1], to: m[2], name: m[3].trim(), body: [] };
      continue;
    }
    // An address is four lines at most. A longer run means the block already
    // ended and this is running text, so stop collecting rather than paste
    // prose into a hotel's address.
    if (current && current.body.length < 5) current.body.push(line);
  }
  flush();

  // A round trip usually sleeps in the same house on its first and last night,
  // and the operator prints the address only once. Where a block has no
  // country, take the location from the sibling block that names the same
  // house — the alternative is a stay that lands nowhere on the map.
  const located = new Map<string, TripStayRow>();
  for (const s of stays) if (s.country) located.set(s.name.toLowerCase(), s);
  return stays.map((s) => {
    if (s.country) return s;
    const twin = located.get(s.name.toLowerCase());
    return twin
      ? { ...s, addressLines: twin.addressLines, city: twin.city, country: twin.country }
      : s;
  });
}

export function parseTripDocument(text: string): TripDocument {
  const all = lines(text);
  const kind = classifyTripDocument(text);

  const bookingRaw = firstMatch(all, /^Buchungs-Nr\.\s+(\S+)/);
  // `1C895383/2` — the suffix counts revisions of the same booking, so a
  // corrected invoice must not read as a different trip.
  const bookingReference = bookingRaw ? bookingRaw.split("/")[0] : null;

  const travellers: string[] = [];
  const travellerStart = all.findIndex((l) => /^REISETEILNEHMER NAME/.test(l));
  if (travellerStart >= 0) {
    for (const line of all.slice(travellerStart + 1)) {
      const m = line.match(new RegExp(String.raw`^\d+ (?:Herr|Frau)\s+(.+?)\s+${DATE}$`));
      if (!m) break;
      travellers.push(m[1].trim());
    }
  }

  const amountLine = all.find((l) => /^Gesamtbetrag\s/.test(l));
  const amount = amountLine?.match(/^Gesamtbetrag\s+([\d.,]+)\s+([A-Z]{3})/);

  const itinerary = kind === "itinerary" ? parseItineraryFlights(all) : { flights: [], countries: [] };

  return {
    kind,
    bookingReference,
    tripCode: firstMatch(all, /^Reise-Code\s+(\S+)/),
    tripName: firstMatch(all, /^Sie haben bei uns gebucht:\s*(.+)$/),
    startDate:
      toIsoDate(firstMatch(all, /^Ihr Reisetag:\s*(\d{2}\.\d{2}\.\d{2,4})\b/) ?? "") ??
      toIsoDate(firstMatch(all, /^Reisedatum\s+(\d{2}\.\d{2}\.\d{2,4})\b/) ?? ""),
    travellers,
    totalPrice: amount ? parseGermanAmount(amount[1]) : null,
    currency: amount ? amount[2] : null,
    flights: kind === "invoice" ? parseInvoiceFlights(all) : itinerary.flights,
    stays: kind === "itinerary" ? parseStays(all) : [],
    countries: itinerary.countries,
  };
}
