import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import request from "supertest";

// The geocoder is the station fallback; no test reaches the network.
const searchPlacesDetailed = jest.fn<(q: string) => Promise<unknown>>();
jest.mock("../../services/geo/photon", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../services/geo/photon");
  return { ...actual, searchPlacesDetailed: (q: string) => searchPlacesDetailed(q) };
});

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  SIXT_INVOICE_ONE_CAR,
  SIXT_LAYOUT_A,
  SIXT_LAYOUT_B,
} from "../../services/rental/parser/__tests__/sixtFixtures";

/**
 * Rentals through the EXISTING parse routes (spec 2026-10-01-rental-domain-design
 * §4): a rental mail reaches the rental reader, `auto` finds it by itself,
 * and a mail of another domain dropped into the rental dialog is named as
 * that domain instead of being read as a rental. Synthetic documents only.
 */
function eml(from: string, subject: string, body: string): Buffer {
  return Buffer.from(
    [
      `From: Provider <${from}>`,
      `Subject: ${subject}`,
      "Date: Tue, 03 Mar 2026 10:00:00 +0100",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      "",
    ].join("\r\n"),
    "utf8"
  );
}

const FLIGHT_MAIL = [
  "Ihre Buchungsbestätigung",
  "Buchungscode: ABC123",
  "LH 400 FRA - JFK",
  "Abflug 10:00, Ankunft 12:40, Terminal 1, Gate A12",
  "Freigepäck: 1 x 23 kg. Online-Check-in ab 23 Stunden vor Abflug.",
  "Jetzt einen Mietwagen dazubuchen!",
].join("\n");

describe("rentals through the parse routes", () => {
  let userId: string;
  let cookie: string;

  beforeEach(() => {
    searchPlacesDetailed.mockReset();
    searchPlacesDetailed.mockResolvedValue({ results: [], degraded: false });
  });

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: {
          username: `rental-parse-${Date.now()}`,
          passwordHash: await hashPassword("x-password"),
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  // Silent-failure class 1: "Frankfurt" names two airports, and the review is
  // offered both rather than a guess or a filtered one.
  it("reads a Sixt mail file and lists every airport a station name fits", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email-file")
      .set("Cookie", cookie)
      .attach(
        "email",
        eml("reservation@e.sixt.com", "Ihre Buchung ist bestätigt", SIXT_LAYOUT_A),
        "a.eml"
      )
      .field("domain", "rental");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ domain: "rental", parserUsed: "template" });
    const [candidate] = res.body.candidates;
    expect(candidate).toMatchObject({
      kind: "confirmation",
      action: "create",
      confirmationNumber: "1234567890",
      stations: { pickup: { status: "ambiguous" } },
    });
    const offered = candidate.stations.pickup.candidates
      .map((c: { iata: string }) => c.iata)
      .sort();
    expect(offered).toEqual(["FRA", "HHN"]);
    expect(candidate.input).toMatchObject({ pickupLocal: "2026-07-06T09:15", returnStation: null });
  });

  // "München" is the German name; the catalogue spells the city "Munich".
  // Before the alias table it found only the closed München-Riem field and
  // stayed unresolved.
  it("places a station named in German at the airport the catalogue spells in English", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: SIXT_LAYOUT_B.replace(/Frankfurt/g, "Stuttgart"), domain: "rental" });
    const [candidate] = res.body.candidates;
    expect(candidate.stations.pickup).toMatchObject({
      status: "resolved",
      airport: { iata: "STR" },
    });
    expect(candidate.stations.return).toMatchObject({
      status: "resolved",
      airport: { iata: "MUC" },
    });
    expect(searchPlacesDetailed).not.toHaveBeenCalled();
  });

  // Class 2: a station no airport answers is offered at the place the
  // geocoder found — a proposal for the review, never a silent placement.
  it("offers the geocoder's place for a station no airport answers", async () => {
    searchPlacesDetailed.mockResolvedValueOnce({
      results: [
        { name: "Testplatz 1", city: "Testhausen", countryCode: "de", lat: 48.1, lon: 11.5 },
      ],
      degraded: false,
    });
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({
        emailContent: SIXT_LAYOUT_B.replace(/Frankfurt/g, "Stuttgart").replace(
          /München Flughafen/g,
          "Testhausen Bahnhof"
        ),
        domain: "rental",
      });
    const [candidate] = res.body.candidates;
    expect(candidate.stations.return).toEqual({
      status: "geocoded",
      place: { label: "Testplatz 1, Testhausen", lat: 48.1, lon: 11.5, country: "DE" },
    });
    expect(candidate.input.returnStation).toEqual({
      name: "Testhausen Bahnhof",
      lat: 48.1,
      lon: 11.5,
      country: "DE",
    });
  });

  // Class 3: a geocoder that could not be reached is said, not read as "nothing found".
  it("names an unreachable geocoder and leaves the station to the review", async () => {
    searchPlacesDetailed.mockResolvedValueOnce({ results: [], degraded: true });
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({
        emailContent: SIXT_LAYOUT_B.replace(/Frankfurt/g, "Stuttgart").replace(
          /München Flughafen/g,
          "Testhausen Bahnhof"
        ),
        domain: "rental",
      });
    const [candidate] = res.body.candidates;
    expect(candidate.stations.return).toEqual({ status: "unresolved", geocoderUnavailable: true });
    expect(candidate.input.returnStation).toEqual({ name: "Testhausen Bahnhof" });
  });

  it("finds a rental by itself when asked for auto", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: SIXT_LAYOUT_A, domain: "auto" });
    expect(res.body.domain).toBe("rental");
    expect(res.body.domainSource).toBe("detected");
  });

  it("leaves a flight mail that advertises a rental car a flight", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: FLIGHT_MAIL, domain: "auto" });
    expect(res.body.domain).toBe("flight");
  });

  it("names a flight dropped into the rental dialog instead of reading it", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: FLIGHT_MAIL, domain: "rental" });
    expect(res.body).toMatchObject({
      domain: "rental",
      candidates: [],
      fallbackCode: "otherDomain",
      domainMismatch: { detected: "flight" },
    });
  });

  it("declines an invoice for a booking the account does not hold — never a new rental", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: SIXT_INVOICE_ONE_CAR, domain: "rental" });
    expect(res.body.candidates[0]).toMatchObject({
      kind: "invoice",
      action: "declined",
      declineCode: "unknownBooking",
      input: null,
    });
  });

  it("says why when no template reads a rental document", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: "Some car rental note without any booking", domain: "rental" });
    expect(res.body).toMatchObject({ candidates: [], fallbackCode: "noTemplate" });
  });
});
