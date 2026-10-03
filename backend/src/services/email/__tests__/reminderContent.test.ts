import { describe, it, expect } from "@jest/globals";
import { renderMailHtml, renderMailText } from "../mailShell";
import {
  REMINDER_DOMAIN_COLORS,
  cruiseReminderContent,
  flightReminderContent,
  lodgingReminderContent,
  railReminderContent,
  type FlightReminderData,
  type LodgingReminderData,
} from "../reminderContent";
import { DOMAINS } from "../../../shared/domains";
import { serializeDay, serializeTime } from "../../../shared/time/wire";

const LINKS = { base: "https://travstats.test" };

/** Both parts of a mail, the way a client would receive them. */
function render(content: Parameters<typeof renderMailHtml>[0]): { html: string; text: string } {
  return { html: renderMailHtml(content), text: renderMailText(content) };
}

const FULL_FLIGHT: FlightReminderData = {
  id: "flight-1",
  tripId: null,
  flightNumber: "LH400",
  airline: "Lufthansa",
  aircraft: "Airbus A340-600",
  seatNumber: "14C",
  seatClass: "business",
  terminal: "1",
  gate: "Z52",
  bookingReference: "X7YZ9Q",
  depName: "Frankfurt am Main",
  depIata: "FRA",
  arrName: "John F. Kennedy International",
  arrIata: "JFK",
  // 08:50 UTC is 10:50 in Frankfurt (CEST); 17:30 UTC is 13:30 in New York (EDT).
  departure: serializeTime(new Date("2026-09-27T08:50:00.000Z"), "Europe/Berlin"),
  arrival: serializeTime(new Date("2026-09-27T17:30:00.000Z"), "America/New_York"),
  durationMinutes: 520,
};

const BARE_FLIGHT: FlightReminderData = {
  id: "flight-2",
  tripId: null,
  flightNumber: null,
  airline: null,
  aircraft: null,
  seatNumber: null,
  seatClass: null,
  terminal: null,
  gate: null,
  bookingReference: null,
  depName: null,
  depIata: "FRA",
  arrName: null,
  arrIata: "JFK",
  departure: serializeTime(new Date("2026-09-27T08:50:00.000Z"), "Europe/Berlin"),
  arrival: null,
  durationMinutes: null,
};

describe("flightReminderContent", () => {
  it("names both airports, both local times and every fact the flight carries — in HTML and in text", () => {
    const content = flightReminderContent(FULL_FLIGHT, 24, "de", LINKS);
    const { html, text } = render(content);

    for (const part of [html, text]) {
      for (const expected of [
        "Dein Flug LH400 geht in 24 Stunden",
        "FRA",
        "Frankfurt am Main",
        "JFK",
        "John F. Kennedy International",
        "So., 27.09.2026, 10:50 Uhr",
        "So., 27.09.2026, 13:30 Uhr",
        "Lufthansa",
        "Terminal",
        "Gate",
        "Z52",
        "14C · Business",
        "Buchungscode",
        "X7YZ9Q",
        "Airbus A340-600",
        "8 Std. 40 Min.",
        "Alle Zeiten sind Ortszeiten.",
        "https://travstats.test/flights/flight-1",
        "https://travstats.test/settings?section=notifications",
      ]) {
        expect(part).toContain(expected);
      }
      // The raw UTC readings never appear.
      expect(part).not.toContain("08:50");
      expect(part).not.toContain("17:30");
    }
    expect(text).toContain("Terminal: 1");
  });

  it("keeps the subject it always had", () => {
    expect(flightReminderContent(FULL_FLIGHT, 24, "de", LINKS).subject).toBe(
      "Flug-Erinnerung: LH400 in 24h"
    );
    expect(flightReminderContent(FULL_FLIGHT, 2, "en", LINKS).subject).toBe(
      "Flight reminder: LH400 in 2h"
    );
    expect(flightReminderContent(BARE_FLIGHT, 24, "de", LINKS).subject).toBe(
      "Flug-Erinnerung: N/A in 24h"
    );
  });

  it("leaves out what the flight does not carry — no empty row, no 'null', no zero", () => {
    const content = flightReminderContent(BARE_FLIGHT, 2, "de", LINKS);
    const { html, text } = render(content);

    for (const part of [html, text]) {
      expect(part).toContain("Dein Flug geht in 2 Stunden");
      for (const absent of [
        "null",
        "undefined",
        "NaN",
        "Airline",
        "Terminal",
        "Gate",
        "Sitzplatz",
        "Klasse",
        "Buchungscode",
        "Flugzeug",
        "Flugdauer",
      ]) {
        expect(part).not.toContain(absent);
      }
    }
    // No fact survived, so the facts table is not drawn at all.
    expect(content.blocks.find((b) => b.kind === "facts")).toEqual({ kind: "facts", rows: [] });
    // The arrival end names the airport and claims no time.
    expect(text).toContain("FRA — So., 27.09.2026, 10:50 Uhr\n→ JFK\n");
  });

  it("treats blank strings and a zero duration as absent", () => {
    const { text } = render(
      flightReminderContent(
        { ...BARE_FLIGHT, airline: "  ", gate: "", seatNumber: " ", durationMinutes: -5 },
        2,
        "en",
        LINKS
      )
    );
    expect(text).not.toMatch(/Airline|Gate|Seat|Duration/);
  });

  it("shows the class alone when there is no seat, and no class it does not know", () => {
    const withClass = render(
      flightReminderContent({ ...BARE_FLIGHT, seatClass: "premium_economy" }, 2, "en", LINKS)
    );
    expect(withClass.text).toContain("Class: Premium Economy");

    const unknown = render(
      flightReminderContent({ ...BARE_FLIGHT, seatClass: "<i>odd</i>" }, 2, "en", LINKS)
    );
    expect(unknown.text).not.toContain("odd");
  });

  it("speaks English to an English user — same facts, other words", () => {
    const { html, text } = render(flightReminderContent(FULL_FLIGHT, 24, "en", LINKS));
    for (const part of [html, text]) {
      expect(part).toContain("Your flight LH400 leaves in 24 hours");
      expect(part).toContain("Sun, Sep 27, 2026, 10:50 AM");
      expect(part).toContain("Sun, Sep 27, 2026, 1:30 PM");
      expect(part).toContain("Booking reference");
      expect(part).toContain("All times are local.");
      expect(part).not.toContain("Uhr");
      expect(part).not.toContain("Buchungscode");
    }
    expect(html).toContain('<html lang="en">');
  });

  it("links to the trip when the flight belongs to one", () => {
    const { text } = render(
      flightReminderContent({ ...FULL_FLIGHT, tripId: "trip-42" }, 24, "de", LINKS)
    );
    expect(text).toContain("In TravStats öffnen: https://travstats.test/trips/trip-42");
    expect(text).not.toContain("/flights/flight-1");
  });

  it("escapes booking-sourced text in the HTML part and keeps it verbatim in the text part", () => {
    const hostile = {
      ...FULL_FLIGHT,
      flightNumber: "<img src=x onerror=alert(1)>",
      airline: "<b>x</b>",
      depName: '"><script>alert(1)</script>',
      gate: "<i>g</i>",
      bookingReference: "<u>r</u>",
    };
    const { html, text } = render(flightReminderContent(hostile, 24, "de", LINKS));
    expect(html).not.toMatch(/<img|<script|<b>|<i>|<u>/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(text).toContain("Airline: <b>x</b>");
  });

  it("says a zoneless time is UTC and does not call it local", () => {
    const { text } = render(
      flightReminderContent(
        {
          ...BARE_FLIGHT,
          departure: serializeTime(new Date("2026-09-27T08:50:00.000Z"), null),
        },
        2,
        "de",
        LINKS
      )
    );
    expect(text).toContain("08:50 Uhr (UTC)");
    expect(text).not.toContain("Ortszeiten");
  });
});

// The reminder shows the PLACE's clock. Two zones no host is likely to share:
// Kiritimati is UTC+14 (the calendar day is already tomorrow), St. John's is
// UTC-2:30 in summer (a half-hour offset). The CI re-runs this suite with TZ
// set to each of them; the expected strings do not move.
describe("times in odd zones", () => {
  it("shows Kiritimati's day and hour, a day ahead of UTC", () => {
    const content = flightReminderContent(
      {
        ...BARE_FLIGHT,
        depIata: "CXI",
        // 11:30 UTC on the 27th is 01:30 on the 28th at UTC+14.
        departure: serializeTime(new Date("2026-09-27T11:30:00.000Z"), "Pacific/Kiritimati"),
        // 20:15 UTC on the 27th is 17:45 the same day at UTC-2:30.
        arrival: serializeTime(new Date("2026-09-27T20:15:00.000Z"), "America/St_Johns"),
        arrIata: "YYT",
      },
      24,
      "de",
      LINKS
    );
    const { html, text } = render(content);
    for (const part of [html, text]) {
      expect(part).toContain("Mo., 28.09.2026, 01:30 Uhr");
      expect(part).toContain("So., 27.09.2026, 17:45 Uhr");
      expect(part).not.toContain("11:30");
      expect(part).not.toContain("20:15");
    }
  });

  it("does the same in English, with a 12-hour clock", () => {
    const content = railReminderContent(
      {
        id: "rail-1",
        tripId: null,
        operator: null,
        trainCategory: null,
        trainNumber: null,
        coach: null,
        seat: null,
        depStationName: "St. John's",
        arrStationName: "London",
        departure: serializeTime(new Date("2026-09-28T02:10:00.000Z"), "America/St_Johns"),
        arrival: serializeTime(new Date("2026-09-27T23:05:00.000Z"), "Pacific/Kiritimati"),
      },
      2,
      "en",
      LINKS
    );
    const { text } = render(content);
    expect(text).toContain("St. John's — Sun, Sep 27, 2026, 11:40 PM");
    expect(text).toContain("→ London — Mon, Sep 28, 2026, 1:05 PM");
  });

  it("names a check-in DAY as that calendar day, whatever zone it belongs to", () => {
    const { text } = render(
      lodgingReminderContent(
        {
          id: "stay-1",
          lodgingId: "lodging-7",
          tripId: null,
          lodgingName: "Captain Cook Hotel",
          city: null,
          country: null,
          roomNumber: null,
          roomCategory: null,
          checkInAt: null,
          checkInDay: serializeDay("2026-01-01", "Pacific/Kiritimati"),
          checkOutDay: serializeDay("2026-01-03", "Pacific/Kiritimati"),
        },
        "de",
        LINKS
      )
    );
    expect(text).toContain("Check-in: Do., 01.01.2026");
    expect(text).toContain("Check-out: Sa., 03.01.2026");
  });
});

describe("cruiseReminderContent", () => {
  const cruise = {
    id: "cruise-1",
    tripId: null,
    shipName: "AIDAnova",
    cruiseLine: "AIDA Cruises",
    routeName: "Kanaren & Madeira",
    portName: "Kiel",
    portCity: "Kiel",
    portCountry: "Germany",
    cabinType: "Balkon",
    cabinNumber: "8102",
    deck: 8,
    bookingReference: "AIDA-4711",
    // 16:00 UTC is 18:00 in Kiel (CEST).
    departure: serializeTime(new Date("2026-09-27T16:00:00.000Z"), "Europe/Berlin"),
    endDay: serializeDay("2026-10-04", "Europe/Berlin"),
  };

  it("shows the port once, its local departure, cabin, return day and booking reference", () => {
    const content = cruiseReminderContent(cruise, 24, "de", LINKS);
    const { html, text } = render(content);
    expect(content.subject).toBe("Kreuzfahrt-Erinnerung: AIDAnova in 24h");
    for (const part of [html, text]) {
      expect(part).toContain("AIDAnova legt in 24 Stunden ab");
      expect(part).toContain("So., 27.09.2026, 18:00 Uhr");
      expect(part).not.toContain("16:00");
      expect(part).toContain("Balkon 8102");
      expect(part).toContain("Kanaren &");
      expect(part).toContain("AIDA-4711");
    }
    expect(text).toContain("Hafen: Kiel, Germany\n");
    expect(text).toContain("Rückkehr: So., 04.10.2026");
    expect(text).toContain("Deck: 8");
    expect(html).toContain("Kanaren &amp; Madeira");
  });

  it("leaves out an unnamed ship, a missing deck and an unknown return day", () => {
    const content = cruiseReminderContent(
      {
        ...cruise,
        shipName: null,
        deck: null,
        endDay: null,
        routeName: null,
        cabinType: null,
        cabinNumber: null,
        bookingReference: null,
      },
      2,
      "en",
      LINKS
    );
    const { text } = render(content);
    expect(content.subject).toBe("Cruise reminder: Departure in 2h");
    expect(text).toContain("Your ship departs in 2 hours");
    expect(text).not.toMatch(/Ship:|Deck|Return|Route|Cabin|Booking reference|null/);
  });

  it("does not name a month-precision end as a return DAY", () => {
    const { text } = render(
      cruiseReminderContent(
        { ...cruise, endDay: { date: "2026-10-01", zone: null, precision: "month" } },
        24,
        "de",
        LINKS
      )
    );
    expect(text).not.toContain("Rückkehr");
  });
});

describe("railReminderContent", () => {
  const journey = {
    id: "rail-1",
    tripId: null,
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    trainNumber: "1001",
    travelClass: "first",
    coach: "12",
    seat: "45",
    bookingReference: "Q3F8KD",
    depStationName: "Berlin Hbf",
    arrStationName: "München Hbf",
    departure: serializeTime(new Date("2026-09-27T06:00:00.000Z"), "Europe/Berlin"),
    arrival: serializeTime(new Date("2026-09-27T10:02:00.000Z"), "Europe/Berlin"),
  };

  it("shows both stations with their local times, train, class, coach, seat and booking reference", () => {
    const content = railReminderContent(journey, 2, "de", LINKS);
    const { html, text } = render(content);
    expect(content.subject).toBe("Zug-Erinnerung: ICE 1001 in 2h");
    for (const part of [html, text]) {
      expect(part).toContain("Deine Zugfahrt ICE 1001 startet in 2 Stunden");
      expect(part).toContain("Berlin Hbf");
      expect(part).toContain("München Hbf");
      expect(part).toContain("08:00 Uhr");
      expect(part).toContain("12:02 Uhr");
      expect(part).toContain("DB Fernverkehr");
      expect(part).toContain("1. Klasse");
      expect(part).toContain("Q3F8KD");
    }
    expect(text).toContain("Wagen: 12\nPlatz: 45");
  });

  it("falls back to the departure station in the subject and omits what is missing", () => {
    const content = railReminderContent(
      {
        ...journey,
        trainCategory: null,
        trainNumber: null,
        operator: null,
        travelClass: null,
        coach: null,
        seat: null,
        bookingReference: null,
        arrival: null,
      },
      24,
      "en",
      LINKS
    );
    const { text } = render(content);
    expect(content.subject).toBe("Rail reminder: Berlin Hbf in 24h");
    expect(text).toContain("Your train leaves in 24 hours");
    expect(text).toContain("→ München Hbf\n");
    expect(text).not.toMatch(/Train:|Operator|Class|Coach|Seat|Booking reference|null/);
  });
});

describe("lodgingReminderContent", () => {
  const stay: LodgingReminderData = {
    id: "stay-1",
    lodgingId: "lodging-7",
    tripId: "trip-9",
    lodgingName: "Hotel Example",
    address: "1-2-3 Shinjuku",
    city: "Tokyo",
    country: "Japan",
    roomNumber: "204",
    roomCategory: "Deluxe Double",
    board: "breakfast",
    guests: 2,
    nights: 3,
    bookingReference: "5087376273",
    checkInAt: null,
    checkInDay: serializeDay("2026-09-27", "Asia/Tokyo"),
    checkOutDay: serializeDay("2026-09-30", "Asia/Tokyo"),
  };

  it("shows where, from when to when, how long, the room and the booking reference", () => {
    const content = lodgingReminderContent(stay, "de", LINKS);
    const { text } = render(content);
    expect(content.subject).toBe("Check-in heute: Hotel Example");
    expect(text).toContain("Heute Check-in bei Hotel Example");
    expect(text).toContain(
      [
        "Unterkunft: Hotel Example",
        "Adresse: 1-2-3 Shinjuku",
        "Ort: Tokyo, Japan",
        "Check-in: So., 27.09.2026",
        "Check-out: Mi., 30.09.2026",
        "Nächte: 3",
        "Zimmer: 204",
        "Kategorie: Deluxe Double",
        "Verpflegung: Frühstück",
        "Gäste: 2",
        "Buchungscode: 5087376273",
      ].join("\n")
    );
    expect(text).toContain("https://travstats.test/trips/trip-9");
    // A check-in DAY is no clock reading, so no "local time" claim is made.
    expect(text).not.toContain("Ortszeiten");
  });

  it("shows the check-in TIME on the property's clock when the stay has one", () => {
    const { text } = render(
      lodgingReminderContent(
        // 06:00 UTC is 15:00 in Tokyo.
        { ...stay, checkInAt: serializeTime(new Date("2026-09-27T06:00:00.000Z"), "Asia/Tokyo") },
        "en",
        LINKS
      )
    );
    expect(text).toContain("Check-in: Sun, Sep 27, 2026, 3:00 PM");
    expect(text).toContain("All times are local.");
  });

  // `/lodging/:id` is the PROPERTY's page. The mail used to put the stay's id
  // there, which opens nothing.
  it("links a stay outside a trip to its property's page, not to the stay's id", () => {
    const { text, html } = render(lodgingReminderContent({ ...stay, tripId: null }, "de", LINKS));
    for (const part of [text, html]) {
      expect(part).toContain("https://travstats.test/lodging/lodging-7");
      expect(part).not.toContain("/lodging/stay-1");
    }
  });

  it("leaves out a board value outside the app's vocabulary instead of printing it raw", () => {
    for (const board of ["constructor", "<b>x</b>", "toString"]) {
      const { text } = render(lodgingReminderContent({ ...stay, board }, "de", LINKS));
      expect(text).not.toContain("Verpflegung");
    }
  });

  it("never prints unknown nights or guests as 0, nor an absent value as 'null'", () => {
    const { html, text } = render(
      lodgingReminderContent(
        {
          ...stay,
          address: null,
          city: null,
          country: null,
          roomNumber: null,
          roomCategory: null,
          board: null,
          guests: 0,
          nights: 0,
          bookingReference: null,
          checkOutDay: null,
        },
        "de",
        LINKS
      )
    );
    for (const part of [html, text]) {
      expect(part).not.toMatch(
        /Nächte|Gäste|Adresse|Ort:|>Ort<|Zimmer|Kategorie|Verpflegung|Buchungscode|Check-out|null|undefined/
      );
    }
    expect(text).toContain("Unterkunft: Hotel Example\nCheck-in: So., 27.09.2026\n");
  });

  it("does not let a hotel named <b>x</b> inject markup — heading, preheader, title and row alike", () => {
    const content = lodgingReminderContent({ ...stay, lodgingName: "<b>x</b>" }, "de", LINKS);
    const { html, text } = render(content);
    expect(html).not.toContain("<b>");
    expect(html.match(/&lt;b&gt;x&lt;\/b&gt;/g)?.length).toBe(4);
    expect(text).toContain("Heute Check-in bei <b>x</b>");
    // The subject is a header, not markup: it carries the name as it is.
    expect(content.subject).toBe("Check-in heute: <b>x</b>");
  });
});

// The header band is the domain colour, so it must BE the domain colour: a
// restated hex survives a palette change unseen. Round 29 (forgejo#131) moved
// rail from brick red to lavender; a mail that kept the old literal would
// have announced a train in the red that means "cancelled".
describe("reminder colours", () => {
  it("are the domain registry's, never a restated hex", () => {
    expect(REMINDER_DOMAIN_COLORS).toEqual({
      flight: DOMAINS.flight.color,
      cruise: DOMAINS.cruise.color,
      rail: DOMAINS.rail.color,
      lodging: DOMAINS.lodging.color,
    });
  });

  it("tint each domain's mail", () => {
    const html = renderMailHtml(flightReminderContent(FULL_FLIGHT, 24, "de", LINKS));
    expect(html).toContain(`bgcolor="${DOMAINS.flight.color}"`);
    const lodging = renderMailHtml(
      lodgingReminderContent(
        {
          id: "s",
          lodgingId: "l",
          tripId: null,
          lodgingName: "H",
          city: null,
          country: null,
          roomNumber: null,
          roomCategory: null,
          checkInAt: null,
          checkInDay: serializeDay("2026-09-27", "Asia/Tokyo"),
        },
        "de",
        LINKS
      )
    );
    expect(lodging).toContain(`bgcolor="${DOMAINS.lodging.color}"`);
  });
});
