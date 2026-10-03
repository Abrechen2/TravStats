import {
  dbOrderFacts,
  parseDbConfirmation,
  parseDbConnectionInfo,
  parseDbPostalOrder,
} from "../dbConfirmation";
import { parseDbOnlineTicket } from "../dbOnlineTicket";
import { decodeCalendar, parseCalendarLegs } from "../icsCalendar";
import { readRailTemplates } from "../railBookingParser";
import { travelClassOf, trainTokenIn } from "../ticketText";
import {
  CALENDAR_WITH_TRAIN,
  DB_CALENDAR,
  DB_CONFIRMATION_CHANGE,
  DB_CONFIRMATION_RETURN,
  DB_CONFIRMATION_SINGLE,
  DB_CONNECTION_INFO,
  DB_DELAY_ALERT,
  DB_NEWSLETTER,
  DB_ONLINE_TICKET,
  DB_ONLINE_TICKET_2024,
  DB_ONLINE_TICKET_2024_CHANGE,
  DB_ONLINE_TICKET_2024_ONE_BLOCK,
  DB_ONLINE_TICKET_2024_RAGGED,
  DB_ORDER_WITHOUT_ITINERARY,
  DB_POSTAL_ORDER,
  FLIGHT_MAIL,
} from "./railFixtures";

/**
 * The DB templates against synthetic tickets in each generation's layout.
 * What matters most is what they do NOT do: invent a train number, read a
 * delay alert as a booking, or take the BahnCard's class for the ticket's.
 */
describe("DB booking confirmation (2020s)", () => {
  it("reads the single short-distance ride, and invents no train", () => {
    const booking = parseDbConfirmation(DB_CONFIRMATION_SINGLE);
    expect(booking).toMatchObject({
      bookingReference: "123456789012",
      travelClass: "second",
      tariff: "Einzelfahrkarte Kurzstrecke",
      price: 3.2,
      currency: "EUR",
      source: "db-confirmation",
    });
    expect(booking?.legs).toEqual([
      {
        depStationName: "Neufahrn(b Freising)",
        arrStationName: "München Flughafen Terminal",
        departureLocal: "2025-06-14T10:12",
        arrivalLocal: "2025-06-14T10:22",
        trainCategory: null,
        trainNumber: null,
        coach: null,
        seat: null,
        direction: null,
      },
    ]);
  });

  it("reads a change as two legs, each with its own train, and a total with thousands", () => {
    const booking = parseDbConfirmation(DB_CONFIRMATION_CHANGE);
    expect(booking?.price).toBe(1084.5);
    expect(booking?.travelClass).toBe("first");
    expect(
      booking?.legs.map((l) => [l.depStationName, l.arrStationName, l.trainCategory, l.trainNumber])
    ).toEqual([
      ["Kiel Hbf", "Hamburg Hbf", "RE", "7"],
      ["Hamburg Hbf", "Bremen Hbf", "ICE", "1507"],
    ]);
  });

  it("marks Hinfahrt and Rückfahrt, and keeps an arrival after midnight on its own day", () => {
    const booking = parseDbConfirmation(DB_CONFIRMATION_RETURN);
    expect(booking?.legs.map((l) => [l.direction, l.departureLocal, l.arrivalLocal])).toEqual([
      ["outbound", "2026-12-20T22:30", "2026-12-21T00:05"],
      ["return", "2026-12-27T16:10", "2026-12-27T17:25"],
    ]);
    expect(booking?.price).toBe(39.8);
  });

  it("does not read a delay alert or a newsletter as a booking", () => {
    for (const text of [DB_DELAY_ALERT, DB_NEWSLETTER]) {
      expect(parseDbConfirmation(text)).toBeNull();
      expect(parseDbPostalOrder(text)).toBeNull();
      expect(parseDbOnlineTicket(text)).toBeNull();
      expect(dbOrderFacts(text)).toBeNull();
    }
  });

  it("does not read a flight mail that mentions Deutsche Bahn", () => {
    expect(parseDbConfirmation(FLIGHT_MAIL)).toBeNull();
    expect(dbOrderFacts(FLIGHT_MAIL)).toBeNull();
  });
});

describe("DB Online-Ticket", () => {
  it("reads one leg per train with coach and seat, the return section, the total and the fare", () => {
    const booking = parseDbOnlineTicket(DB_ONLINE_TICKET);
    expect(booking).toMatchObject({
      bookingReference: "Q7X2KT",
      travelClass: "second",
      tariff: "Flexpreis (Hin- und Rückfahrt)",
      price: 122.5,
      currency: "EUR",
      source: "db-online-ticket",
    });
    expect(
      booking?.legs.map((l) => [
        l.direction,
        l.depStationName,
        l.arrStationName,
        l.departureLocal,
        l.arrivalLocal,
        `${l.trainCategory} ${l.trainNumber}`,
        l.coach,
        l.seat,
      ])
    ).toEqual([
      [
        "outbound",
        "Osnabrück Hbf",
        "Hannoversch Musterdorf",
        "2016-05-02T07:12",
        "2016-05-02T08:05",
        "IC 2217",
        "7",
        "45",
      ],
      [
        "outbound",
        "Hannoversch Musterdorf",
        "Magdeburg Hbf",
        "2016-05-02T08:31",
        "2016-05-02T09:59",
        "RE 8",
        null,
        null,
      ],
      [
        "return",
        "Magdeburg Hbf",
        "Osnabrück Hbf",
        "2016-05-06T17:02",
        "2016-05-06T19:40",
        "ICE 1507",
        null,
        null,
      ],
    ]);
  });
});

describe("DB postal order and connection info", () => {
  it("reads the whole-journey lines without a train, and the ticket's class, not the BahnCard's", () => {
    const booking = parseDbPostalOrder(DB_POSTAL_ORDER);
    expect(booking).toMatchObject({
      bookingReference: "ZZ12AB",
      price: 153.9,
      travelClass: "second",
    });
    expect(booking?.legs.map((l) => [l.depStationName, l.arrStationName, l.trainNumber])).toEqual([
      ["Rostock Hbf", "Erfurt Hbf", null],
      ["Erfurt Hbf", "Rostock Hbf", null],
    ]);
  });

  it("reads each train row, skips the walk, and rolls an after-midnight arrival to the next day", () => {
    const booking = parseDbConnectionInfo(DB_CONNECTION_INFO);
    expect(booking?.bookingReference).toBe("11223344");
    expect(booking?.price).toBe(55.2);
    expect(
      booking?.legs.map((l) => [
        l.depStationName,
        l.arrStationName,
        l.departureLocal,
        l.arrivalLocal,
        l.trainNumber,
      ])
    ).toEqual([
      ["Kiel Hbf", "Hamburg Hbf", "2008-03-21T23:10", "2008-03-22T00:25", "21013"],
      ["Hamburg Hbf", "Bremen Hbf", "2008-03-22T06:01", "2008-03-22T06:59", "870"],
    ]);
  });
});

describe("calendar attachment", () => {
  it("reads the verified DB layout, folded lines and the malformed zone id included", () => {
    expect(parseCalendarLegs(DB_CALENDAR)).toEqual([
      expect.objectContaining({
        depStationName: "Kiel Hbf",
        arrStationName: "Bremen Hbf",
        departureLocal: "2026-03-14T08:05",
        arrivalLocal: "2026-03-14T10:43",
        trainNumber: null,
      }),
    ]);
  });

  it("copies a train from the summary when one stands there, and skips a UTC-only event", () => {
    const legs = parseCalendarLegs(CALENDAR_WITH_TRAIN);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      depStationName: "Hamburg Hbf",
      arrStationName: "Bremen Hbf",
      trainCategory: "ICE",
      trainNumber: "1507",
    });
  });

  it("reads a latin1 file as latin1", () => {
    const latin1 = Buffer.from("SUMMARY:Lübeck Hbf -> Kiel Hbf", "latin1");
    expect(decodeCalendar(latin1)).toBe("SUMMARY:Lübeck Hbf -> Kiel Hbf");
  });
});

describe("readRailTemplates — mail, attached ticket and calendar together", () => {
  it("takes the legs from the attached ticket and the order's reference and total from the mail", async () => {
    const result = await readRailTemplates(DB_ORDER_WITHOUT_ITINERARY, [
      { filename: "ticket.ics", mediaType: "text/calendar", content: Buffer.from(DB_CALENDAR) },
    ]);
    expect(result.booking?.source).toBe("ics");
    expect(result.booking?.bookingReference).toBe("Q7X2KT");
    expect(result.booking?.price).toBe(122.5);
    expect(result.booking?.legs).toHaveLength(1);
  });

  it("fills a leg's train from the calendar file when the mail prints none", async () => {
    const result = await readRailTemplates(
      DB_CONFIRMATION_CHANGE.replace(/^(RE 7|ICE 1507)$/gm, ""),
      [
        {
          filename: "BAHN_Hinfahrt.ics",
          mediaType: "text/calendar",
          content: Buffer.from(CALENDAR_WITH_TRAIN),
        },
      ]
    );
    expect(result.booking?.legs.map((l) => l.trainNumber)).toEqual([null, "1507"]);
  });

  it("names the order when a DB mail prints no ride and nothing is attached", async () => {
    const result = await readRailTemplates(DB_ORDER_WITHOUT_ITINERARY, []);
    expect(result.booking).toBeNull();
    expect(result.orderReference).toBe("Q7X2KT");
  });

  it("survives an unreadable PDF attachment", async () => {
    const result = await readRailTemplates(DB_CONFIRMATION_SINGLE, [
      { filename: "ticket.pdf", mediaType: "application/pdf", content: Buffer.from("not a pdf") },
    ]);
    expect(result.booking?.legs).toHaveLength(1);
  });
});

describe("ticketText", () => {
  it("finds a train token only in its own shape", () => {
    expect(trainTokenIn("Kundennummer 123456")).toBeNull();
    expect(trainTokenIn("HRB 83 173")).toBeNull();
    expect(trainTokenIn("mit ICE 578 nach")).toEqual({ category: "ICE", number: "578" });
  });

  it("does not take the BahnCard's class for the ticket's", () => {
    expect(travelClassOf("1 Reisender mit BahnCard 50 (1. Klasse), 2. Kl.")).toBe("second");
  });
});

describe("DB Online-Ticket, the layout since spring 2024", () => {
  const rows = (text: string) =>
    parseDbOnlineTicket(text)?.legs.map((l) => [
      l.direction,
      l.depStationName,
      l.arrStationName,
      l.departureLocal,
      l.arrivalLocal,
      l.trainCategory === null ? null : `${l.trainCategory} ${l.trainNumber}`,
      l.coach,
      l.seat,
    ]);

  it("reads a ticket whose table is extracted column by column", () => {
    expect(parseDbOnlineTicket(DB_ONLINE_TICKET_2024)).toMatchObject({
      bookingReference: "123456789012",
      travelClass: "first",
      tariff: "Flexpreis (Einfache Fahrt)",
      price: 91.6,
      currency: "EUR",
      source: "db-online-ticket",
    });
    expect(rows(DB_ONLINE_TICKET_2024)).toEqual([
      [
        "outbound",
        "Musterstadt Hbf",
        "Beispielburg Hbf",
        "2024-04-19T19:55",
        "2024-04-19T23:58",
        "ICE 615",
        "12",
        "133",
      ],
    ]);
  });

  it("reads a change of trains: one block of columns per train, each with its own train and seat", () => {
    // rc.5 read only the first block, and that one without its train.
    expect(rows(DB_ONLINE_TICKET_2024_CHANGE)).toEqual([
      [
        "outbound",
        "Musterstadt Hbf",
        "Mittelhausen",
        "2024-12-30T08:00",
        "2024-12-30T09:10",
        "ICE 615",
        "12",
        "33",
      ],
      [
        "outbound",
        "Mittelhausen",
        "Beispielburg Hbf",
        "2024-12-30T09:25",
        "2024-12-30T10:40",
        "IC 4711",
        "4",
        "87",
      ],
    ]);
  });

  it("reads a journey printed as one block of four stops the same way", () => {
    expect(rows(DB_ONLINE_TICKET_2024_ONE_BLOCK)?.map((r) => [r[1], r[2], r[5]])).toEqual([
      ["Musterstadt Hbf", "Mittelhausen", "ICE 615"],
      ["Mittelhausen", "Beispielburg Hbf", "RE 4711"],
    ]);
  });

  it("reads nothing from columns of unequal length rather than pairing them by guess", () => {
    expect(parseDbOnlineTicket(DB_ONLINE_TICKET_2024_RAGGED)).toBeNull();
  });
});
