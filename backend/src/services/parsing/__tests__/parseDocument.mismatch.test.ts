/**
 * Acceptance D1 (2026-09-26): a Lufthansa booking mail dropped into the rail
 * dialog was parsed AS rail — the model fallback found two "train rides"
 * MUC→FRA and FRA→MUC and the review offered "Mücka" and "Frant" as stations.
 * Detection now runs first, whatever the dialog, and a document that is
 * clearly another domain is answered with that finding instead of a reading.
 */

jest.mock("../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => true),
  recordLlmProbe: jest.fn(),
}));
jest.mock("../../bookingParser", () => ({
  parseBookingText: jest.fn(async () => ({ flights: [], parserUsed: "template" })),
  parseBookingEmail: jest.fn(),
}));
jest.mock("../../rail/parser/railBookingParser", () => ({
  parseRailBookingText: jest.fn(async () => {
    throw new Error("the rail parser must not run for a flight document");
  }),
}));

import { parseDocument } from "../parseDocument";
import { conclusiveOtherDomain, scoreDocument } from "../documentDomain";
import { parseRailBookingText } from "../../rail/parser/railBookingParser";
import {
  DB_CALENDAR,
  DB_CONFIRMATION_SINGLE,
  FLIGHT_MAIL,
  FLIGHT_MAIL_MUC_FRA,
  FOREIGN_TICKET_THIN,
  HOTEL_MAIL,
} from "../../rail/parser/__tests__/railFixtures";

describe("a document dropped into the wrong dialog", () => {
  it("answers the rail dialog with the flight it is, and never reads it as rail", async () => {
    const outcome = await parseDocument({
      text: FLIGHT_MAIL_MUC_FRA,
      domain: "rail",
      source: "email",
      userId: "u1",
    });
    expect(parseRailBookingText).not.toHaveBeenCalled();
    expect(outcome.body).toMatchObject({
      domain: "rail",
      bookings: [],
      parserUsed: "none",
      fallbackCode: "otherDomain",
      domainMismatch: { detected: "flight" },
    });
  });

  it("answers the cruise dialog with the hotel stay it is", async () => {
    const outcome = await parseDocument({ text: HOTEL_MAIL, domain: "cruise", source: "email" });
    expect(outcome.body).toMatchObject({
      domain: "cruise",
      cruises: [],
      domainMismatch: { detected: "lodging" },
    });
  });

  it("leaves a flight request alone — older clients read `flights` from it", async () => {
    // The flight dialog is the default a caller without `domain` gets; its
    // answer keeps its shape whatever the document is.
    const outcome = await parseDocument({ text: HOTEL_MAIL, domain: "flight", source: "document" });
    expect(outcome.body.domain).toBe("flight");
    expect(outcome.body).not.toHaveProperty("domainMismatch");
  });
});

describe("conclusiveOtherDomain — the dialog wins only when the document is inconclusive", () => {
  const verdict = (text: string): string | null =>
    conclusiveOtherDomain(scoreDocument(text), "rail");

  it("overrules the rail dialog for a flight or a hotel mail", () => {
    expect(verdict(FLIGHT_MAIL_MUC_FRA)).toBe("flight");
    expect(verdict(FLIGHT_MAIL)).toBe("flight");
    expect(verdict(HOTEL_MAIL)).toBe("lodging");
  });

  it("keeps rail documents, thin ones and signal-free ones with the rail dialog", () => {
    // A DB confirmation also scores flight signals ("Flughafen" stations).
    expect(verdict(DB_CONFIRMATION_SINGLE)).toBeNull();
    expect(verdict(DB_CALENDAR)).toBeNull();
    expect(verdict(FOREIGN_TICKET_THIN)).toBeNull();
  });
});
