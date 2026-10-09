jest.mock("../../../parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: "test-model" })),
  getParserOrder: jest.fn(async () => "llm_first"),
}));
jest.mock("../../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => true),
  recordLlmProbe: jest.fn(),
}));
// An attached "PDF" is its own text here: the extraction is not what is tested.
jest.mock("../../../pdfParser", () => ({
  extractTextFromPdf: jest.fn(async (content: Buffer) => content.toString("utf8")),
}));

import { READERS } from "./readers";
import { parseRailBookingText, readRailTemplates } from "../railBookingParser";
import {
  DB_CONFIRMATION_CHANGE,
  DB_CONFIRMATION_SINGLE,
  DB_ONLINE_TICKET,
  DB_ONLINE_TICKET_2024,
  DB_ONLINE_TICKET_2024_CHANGE,
  DB_ONLINE_TICKET_2024_ONE_BLOCK,
  DB_ORDER_WITHOUT_ITINERARY,
} from "./railFixtures";
import {
  DB_RESERVATION_2024,
  DB_RESERVATION_MAIL,
  DB_RESERVATION_ROWS,
  DB_TICKET_WITH_RESERVATION_MAIL,
} from "./railReservationFixtures";

const pdf = (text: string) => ({
  filename: "ticket.pdf",
  mediaType: "application/pdf",
  content: Buffer.from(text, "utf8"),
});

describe.each(READERS)(
  "DB seat reservation recognition (forgejo#203) (%s)",
  (_reader, { parseDbReservation, isDbReservationDocument }) => {
    it("recognises the three assumed reservation layouts", () => {
      for (const text of [DB_RESERVATION_2024, DB_RESERVATION_ROWS, DB_RESERVATION_MAIL]) {
        expect(isDbReservationDocument(text)).toBe(true);
      }
    });

    it("never takes a ticket for a reservation — not even one that books a seat", () => {
      for (const text of [
        DB_ONLINE_TICKET,
        DB_ONLINE_TICKET_2024,
        DB_ONLINE_TICKET_2024_CHANGE,
        DB_ONLINE_TICKET_2024_ONE_BLOCK,
        DB_CONFIRMATION_SINGLE,
        DB_CONFIRMATION_CHANGE,
        DB_ORDER_WITHOUT_ITINERARY,
        DB_TICKET_WITH_RESERVATION_MAIL,
      ]) {
        expect(isDbReservationDocument(text)).toBe(false);
      }
    });

    it("reads train, day, stations, coach and seat from the 2024 column layout", () => {
      expect(parseDbReservation(DB_RESERVATION_2024)).toMatchObject({
        documentKind: "reservation",
        source: "db-reservation",
        bookingReference: "310987654321",
        price: null,
        legs: [
          {
            depStationName: "Musterstadt Hbf",
            arrStationName: "Beispielburg Hbf",
            departureLocal: "2026-04-19T19:55",
            arrivalLocal: "2026-04-19T23:58",
            trainCategory: "ICE",
            trainNumber: "615",
            coach: "12",
            seat: "133",
          },
        ],
      });
    });

    it("reads each train's own seat from the row layout, two seats as one value", () => {
      const legs = parseDbReservation(DB_RESERVATION_ROWS)?.legs ?? [];
      expect(legs.map((l) => [l.trainNumber, l.depStationName, l.coach, l.seat])).toEqual([
        ["1507", "Mittelhausen", "7", "45 46"],
        ["2217", "Beispielburg Hbf", "4", "87"],
      ]);
    });

    it("reads the reservation mail, its seat from the ride's own block", () => {
      expect(parseDbReservation(DB_RESERVATION_MAIL)).toMatchObject({
        bookingReference: "410987654321",
        travelClass: "second",
        price: null,
        legs: [{ trainCategory: "ICE", trainNumber: "615", coach: "12", seat: "133" }],
      });
    });

    it("is no reservation when it is a ticket", () => {
      expect(parseDbReservation(DB_TICKET_WITH_RESERVATION_MAIL)).toBeNull();
      expect(parseDbReservation(DB_ONLINE_TICKET_2024)).toBeNull();
    });
  }
);

describe("the template pipeline with a reservation", () => {
  it("answers a reservation mail as a reservation, not as new rides", async () => {
    const { booking } = await readRailTemplates(DB_RESERVATION_MAIL);
    expect(booking).toMatchObject({ documentKind: "reservation", legs: [{ seat: "133" }] });
  });

  it("answers a reservation PDF sent alone as a reservation", async () => {
    const { booking } = await readRailTemplates("Ihre Reservierung im Anhang.", [
      pdf(DB_RESERVATION_ROWS),
    ]);
    expect(booking?.documentKind).toBe("reservation");
    expect(booking?.legs).toHaveLength(2);
  });

  it("keeps a ticket a booking, and gives its legs the seat a reservation sent with it names", async () => {
    const { booking } = await readRailTemplates("Ihre Fahrkarte im Anhang.", [
      pdf(DB_ONLINE_TICKET_2024.replace(/, Wg\. 12, Pl\. 133/, "")),
      pdf(DB_RESERVATION_2024.replace(/19\.04\.2026/g, "19.04.2024")),
    ]);
    expect(booking?.documentKind).toBeUndefined();
    expect(booking?.legs).toEqual([
      expect.objectContaining({ trainNumber: "615", coach: "12", seat: "133" }),
    ]);
  });

  it("answers from the template even when the model is asked first", async () => {
    const result = await parseRailBookingText(DB_RESERVATION_2024);
    expect(result).toMatchObject({
      parserUsed: "template",
      booking: { documentKind: "reservation" },
    });
  });
});
