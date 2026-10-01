import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

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

  // Class 2: a station the catalogue cannot place stays unresolved — the
  // review asks; it is never written at a guessed airport.
  it("places a unique station and leaves an unplaceable one to the review", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: SIXT_LAYOUT_B.replace(/Frankfurt/g, "Stuttgart"), domain: "rental" });
    const [candidate] = res.body.candidates;
    expect(candidate.stations.pickup).toMatchObject({
      status: "resolved",
      airport: { iata: "STR" },
    });
    // "München" is the German name; the catalogue spells the city "Munich".
    expect(candidate.stations.return).toEqual({ status: "unresolved" });
    expect(candidate.input.returnStation).toEqual({ name: "München Flughafen" });
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
