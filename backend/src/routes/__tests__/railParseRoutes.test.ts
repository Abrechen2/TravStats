import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();
jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
  isBcbpText: () => false,
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { foldStationName } from "../../services/rail/railStations";
import {
  DB_CALENDAR,
  DB_CONFIRMATION_SINGLE,
  DB_ORDER_WITHOUT_ITINERARY,
  FOREIGN_TICKET_THIN,
} from "../../services/rail/parser/__tests__/railFixtures";

/**
 * The rail parser through the EXISTING import routes: the mail text route,
 * the mail file route (with a calendar attachment), the PDF route and `auto`.
 * The parser is not mocked; only the PDF text layer is, because the routes'
 * own PDF handling is what these tests pin, not pdf-parse.
 */
const PDF = Buffer.from("%PDF-1.4\n% rail\n%%EOF");
const PREFIX = `test-railroutes-${Date.now()}-`;

/** A multipart .eml: the order mail as text, the calendar file as an attachment. */
function emlWithCalendar(): Buffer {
  const boundary = "XYZ-rail-boundary";
  return Buffer.from(
    [
      "From: DB Vertrieb <buchungsbestaetigung@bahn.de>",
      "Subject: Buchungsbestätigung (Auftrag Q7X2KT)",
      "Date: Tue, 03 Mar 2026 10:00:00 +0100",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      DB_ORDER_WITHOUT_ITINERARY,
      `--${boundary}`,
      'Content-Type: text/calendar; charset=utf-8; name="BAHN_Hinfahrt.ics"',
      'Content-Disposition: attachment; filename="BAHN_Hinfahrt.ics"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(DB_CALENDAR, "utf8").toString("base64"),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
    "utf8"
  );
}

describe("rail through the parse routes", () => {
  let userId: string;
  let cookie: string;
  const previousOllama = process.env.OLLAMA_URL;

  beforeAll(async () => {
    // A configured model that does not answer: the failure path is the point.
    process.env.OLLAMA_URL = "http://127.0.0.1:9";
    userId = (
      await prisma.user.create({
        data: {
          username: `rail-parse-routes-${Date.now()}`,
          passwordHash: await hashPassword("test-password"),
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.railStation.createMany({
      data: [
        { name: "Neufahrn (b Freising)", lat: 48.32164, lon: 11.661265, uic: "8020489" },
        { name: "München Flughafen Terminal", lat: 48.353731, lon: 11.785972, uic: "8020658" },
      ].map((s, i) => ({
        ...s,
        sourceId: `${PREFIX}${i}`,
        searchName: foldStationName(s.name),
        country: "DE",
        timezone: "Europe/Berlin",
      })),
    });
  });

  beforeEach(() => {
    extractTextFromPdf.mockReset();
  });

  afterAll(async () => {
    process.env.OLLAMA_URL = previousOllama;
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it("reads a pasted DB confirmation as one leg with both stations resolved", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: DB_CONFIRMATION_SINGLE, domain: "rail" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ domain: "rail", parserUsed: "template" });
    const [booking] = res.body.bookings;
    expect(booking).toMatchObject({
      bookingReference: "123456789012",
      price: 3.2,
      currency: "EUR",
    });
    expect(booking.legs[0]).toMatchObject({
      departureLocal: "2025-06-14T10:12",
      trainNumber: null,
      departureStation: {
        name: "Neufahrn (b Freising)",
        printedName: "Neufahrn(b Freising)",
        resolved: true,
      },
      arrivalStation: { name: "München Flughafen Terminal", resolved: true },
      duplicateOf: null,
    });
  });

  it("decides rail by itself when asked for auto", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: DB_CONFIRMATION_SINGLE, domain: "auto" });

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("rail");
    expect(res.body.domainSource).toBe("detected");
    expect(res.body.detection.candidates[0].domain).toBe("rail");
  });

  it("reads the legs of an .eml from its attached calendar file", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email-file")
      .set("Cookie", cookie)
      .attach("email", emlWithCalendar(), "order.eml")
      .field("domain", "rail");

    expect(res.status).toBe(200);
    const [booking] = res.body.bookings;
    expect(booking).toMatchObject({ bookingReference: "Q7X2KT", price: 122.5, source: "ics" });
    expect(booking.legs[0]).toMatchObject({
      depStationName: "Kiel Hbf",
      arrStationName: "Bremen Hbf",
      departureLocal: "2026-03-14T08:05",
    });
  });

  it("reads a DB confirmation PDF", async () => {
    extractTextFromPdf.mockResolvedValue(DB_CONFIRMATION_SINGLE);
    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF.toString("base64"), domain: "rail" });

    expect(res.status).toBe(200);
    expect(res.body.bookings[0].legs).toHaveLength(1);
    expect(res.body).not.toHaveProperty("bcbpDetected");
  });

  it("answers an unreadable PDF with its code, and runs no parser", async () => {
    extractTextFromPdf.mockRejectedValue(new Error("bad XRef entry"));
    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF.toString("base64"), domain: "rail" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PDF");
  });

  it("names why nothing was read: an unknown layout with the model unreachable", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: FOREIGN_TICKET_THIN, domain: "rail" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      domain: "rail",
      bookings: [],
      parserUsed: "none",
      fallbackCode: "llmUnreachable",
    });
  });

  it("names the order of a legless DB mail", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: DB_ORDER_WITHOUT_ITINERARY, domain: "rail" });

    expect(res.body).toMatchObject({
      bookings: [],
      fallbackCode: "noItinerary",
      orderReference: "Q7X2KT",
    });
  });
});
