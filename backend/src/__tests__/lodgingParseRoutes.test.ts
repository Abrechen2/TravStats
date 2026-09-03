import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

jest.mock("../services/lodging/lodgingBookingParser", () => ({
  parseLodgingBookingText: jest.fn(async () => ({
    bookings: [
      {
        hotelName: "Musterhotel",
        checkIn: "2026-01-05",
        checkOut: "2026-01-07",
        nights: 2,
        roomCategory: "Superior Zimmer",
        address: "Musterweg 1",
        postcode: "12345",
        city: "Musterstadt",
        country: "Deutschland",
        totalPrice: 250,
        currency: "EUR",
        confirmationNumber: "1234567890",
        parserTemplate: "booking.com",
        parserConfidence: 95,
        missing: [],
      },
    ],
    parserUsed: "template",
    ollamaAvailable: false,
  })),
}));

// The flight branch normally dials a real (possibly LAN-reachable) Ollama
// instance, which makes a live round trip slow and environment-dependent.
// The regression check here only needs to prove the route still reaches
// the flight parser (and does NOT fall into the new lodging branch) — the
// flight parser's own behaviour is covered by its own test suite.
jest.mock("../services/bookingParser", () => ({
  parseBookingEmail: jest.fn(async () => ({
    flights: [],
    parserUsed: "regex",
    ollamaAvailable: false,
  })),
}));

// Same reason as the flight branch above, and it was simply not carried over
// when the cruise branch stopped being a 501 stub: the regression below only
// proves the route still REACHES the cruise parser and does not fall into the
// lodging branch. Left unmocked it dialled a real Ollama instance, and on a
// machine without one the test spent the full 30 s budget and failed — the
// only red suite in an otherwise green backend run, on main as well as on
// every branch off it.
jest.mock("../services/cruiseBookingParser", () => ({
  parseCruiseBookingText: jest.fn(async () => ({
    cruises: [],
    parserUsed: "ollama",
    ollamaAvailable: false,
  })),
}));

import { parseLodgingBookingText } from "../services/lodging/lodgingBookingParser";
import { parseBookingEmail } from "../services/bookingParser";

const mockParseLodgingBookingText = parseLodgingBookingText as jest.MockedFunction<
  typeof parseLodgingBookingText
>;
const mockParseBookingEmail = parseBookingEmail as jest.MockedFunction<typeof parseBookingEmail>;

describe("lodging domain wired into the parse routes", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    const user = await prisma.user.create({
      data: {
        username: `lodging-parse-route-test-${timestamp}`,
        passwordHash: await hashPassword("pw123456"),
        isAdmin: false,
        isActive: true,
      },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockParseLodgingBookingText.mockClear();
    mockParseBookingEmail.mockClear();
  });

  // -----------------------------------------------------------------------
  // /parse-email
  // -----------------------------------------------------------------------

  describe("POST /api/v1/parse-email (domain=lodging)", () => {
    it("returns lodging candidates for domain=lodging", async () => {
      const res = await request(app)
        .post("/api/v1/parse-email")
        .set("Cookie", [`auth_token=${token}`])
        .send({
          emailContent: "Bestätigungsnummer: 1234567890",
          subject: "Ihre Buchung ist bestätigt: Musterhotel",
          domain: "lodging",
        });

      expect(res.status).toBe(200);
      expect(res.body.domain).toBe("lodging");
      expect(res.body.parserUsed).toBe("template");
      expect(res.body.ollamaAvailable).toBe(false);
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].lodging.name).toBe("Musterhotel");
      expect(res.body.candidates[0].lodging.city).toBe("Musterstadt");
      expect(res.body.candidates[0].stay.checkIn).toBe("2026-01-05");
      expect(res.body.candidates[0].stay.checkOut).toBe("2026-01-07");
      expect(res.body.candidates[0].stay.totalPrice).toBe(250);
      expect(res.body.candidates[0].stay.externalRef).toBe("booking:1234567890");
    });

    it("returns a clean 'could not parse' result instead of a 500 when nothing is found", async () => {
      mockParseLodgingBookingText.mockResolvedValueOnce({
        bookings: [],
        parserUsed: "none",
        ollamaAvailable: false,
        fallbackReason: "Ollama is not reachable at http://localhost:11434",
      });

      const res = await request(app)
        .post("/api/v1/parse-email")
        .set("Cookie", [`auth_token=${token}`])
        .send({ emailContent: "totally unrelated content", domain: "lodging" });

      expect(res.status).toBe(200);
      expect(res.body.domain).toBe("lodging");
      expect(res.body.parserUsed).toBe("none");
      expect(res.body.candidates).toEqual([]);
      expect(typeof res.body.fallbackReason).toBe("string");
    });

    it("rejects an unauthenticated request", async () => {
      const res = await request(app)
        .post("/api/v1/parse-email")
        .send({ emailContent: "Bestätigungsnummer: 1234567890", domain: "lodging" });
      expect(res.status).toBe(401);
    });

    it("still accepts domain=flight (regression)", async () => {
      const res = await request(app)
        .post("/api/v1/parse-email")
        .set("Cookie", [`auth_token=${token}`])
        .send({ emailContent: "no flights here", domain: "flight" });
      expect(res.status).toBeLessThan(500);
      expect(res.body.domain).not.toBe("lodging");
      expect(mockParseLodgingBookingText).not.toHaveBeenCalled();
      expect(mockParseBookingEmail).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // /parse-email-file
  // -----------------------------------------------------------------------

  describe("POST /api/v1/parse-email-file (domain=lodging)", () => {
    it("returns lodging candidates for a .eml upload", async () => {
      const res = await request(app)
        .post("/api/v1/parse-email-file")
        .set("Cookie", [`auth_token=${token}`])
        .attach("email", Buffer.from("From: test@example.com\nSubject: test\n\nBody"), "x.eml")
        .field("domain", "lodging");

      expect(res.status).toBe(200);
      expect(res.body.domain).toBe("lodging");
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].lodging.name).toBe("Musterhotel");
      expect(res.body.candidates[0].stay.totalPrice).toBe(250);
    });

    it("returns a clean 'could not parse' result for an unparseable file (not a 500)", async () => {
      mockParseLodgingBookingText.mockResolvedValueOnce({
        bookings: [],
        parserUsed: "none",
        ollamaAvailable: true,
        fallbackReason: "The AI parser read this document and found no booking in it",
      });

      const res = await request(app)
        .post("/api/v1/parse-email-file")
        .set("Cookie", [`auth_token=${token}`])
        .attach("email", Buffer.from("From: test@example.com\nSubject: garbage\n\nnothing useful"), "x.eml")
        .field("domain", "lodging");

      expect(res.status).toBe(200);
      expect(res.body.domain).toBe("lodging");
      expect(res.body.parserUsed).toBe("none");
      expect(res.body.candidates).toEqual([]);
      expect(typeof res.body.fallbackReason).toBe("string");
    });

    it("rejects an unauthenticated request", async () => {
      const res = await request(app)
        .post("/api/v1/parse-email-file")
        .attach("email", Buffer.from("From: test@example.com\n\nBody"), "x.eml")
        .field("domain", "lodging");
      expect(res.status).toBe(401);
    });

    it("still accepts domain=cruise (regression, no longer a 501 stub)", async () => {
      const res = await request(app)
        .post("/api/v1/parse-email-file")
        .set("Cookie", [`auth_token=${token}`])
        .attach("email", Buffer.from("dummy"), "x.eml")
        .field("domain", "cruise");
      expect(res.status).not.toBe(501);
      expect(mockParseLodgingBookingText).not.toHaveBeenCalled();
    }, 30000);
  });

  // -----------------------------------------------------------------------
  // /parse-pdf
  // -----------------------------------------------------------------------

  describe("POST /api/v1/parse-pdf (domain=lodging)", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app)
        .post("/api/v1/parse-pdf")
        .send({ pdfBase64: "AAAA", domain: "lodging" });
      expect(res.status).toBe(401);
    });

    it("still accepts domain=cruise (regression, no longer a 501 stub)", async () => {
      const res = await request(app)
        .post("/api/v1/parse-pdf")
        .set("Cookie", [`auth_token=${token}`])
        .send({ pdfBase64: "AAAA", domain: "cruise" });
      expect(res.status).not.toBe(501);
      if (res.status === 400 && typeof res.body?.error === "string") {
        expect(res.body.error.toLowerCase()).not.toContain("domain");
      }
    });
  });
});
