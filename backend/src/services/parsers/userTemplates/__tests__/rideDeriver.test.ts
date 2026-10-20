import { describe, it, expect } from "@jest/globals";
import { deriveBusTemplate, deriveFerryTemplate } from "../rideDeriver";
import { applyV2RideTicketTemplate } from "../../../rides/v2RideTicket";
import { workshopEnvelopeSchema } from "../../templates/v2/envelope";
import { previewTemplate } from "../preview";
import type { UserTemplate } from "../types";
import {
  BUS_FOREIGN,
  BUS_HELD_OUT,
  BUS_SELECTIONS,
  BUS_SOURCE,
  BUS_SUBJECT,
  FERRY_FOREIGN,
  FERRY_HELD_OUT,
  FERRY_SELECTIONS,
  FERRY_SOURCE,
  FERRY_SUBJECT,
} from "./rideSamples";

/**
 * forgejo#309 — the workshop derives bus and ferry templates: booking fields
 * from label patterns, every ride from ONE marked row, the day from the row
 * or from the heading in force above it. Run through the consumer the parse
 * uses (`rides/v2RideTicket.ts`), never a test double.
 */
const busInput = {
  trainingDataId: "td-bus-1",
  subject: BUS_SUBJECT,
  fullText: BUS_SOURCE,
  selections: BUS_SELECTIONS,
};
const ferryInput = {
  trainingDataId: "td-ferry-1",
  subject: FERRY_SUBJECT,
  fullText: FERRY_SOURCE,
  selections: FERRY_SELECTIONS,
};

function busTemplate() {
  const result = deriveBusTemplate(busInput);
  if (!result.ok) throw new Error(`bus derivation refused: ${result.refusal}`);
  return result.template;
}
function ferryTemplate() {
  const result = deriveFerryTemplate(ferryInput);
  if (!result.ok) throw new Error(`ferry derivation refused: ${result.refusal}`);
  return result.template;
}

const userTemplate = (patterns: unknown): UserTemplate => ({
  id: "t",
  userId: "u",
  name: "t",
  status: "pending",
  fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
  patterns: patterns as UserTemplate["patterns"],
  createdAt: "2028-01-01T00:00:00Z",
  updatedAt: "2028-01-01T00:00:00Z",
});

describe("deriveBusTemplate", () => {
  const read = (text: string, subject = BUS_SUBJECT) =>
    applyV2RideTicketTemplate(busTemplate(), `${subject}\n${text}`);

  it("writes a bus workshop envelope the shared schema accepts", () => {
    const t = busTemplate();
    expect(workshopEnvelopeSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ id: "bus:user-td-bus-1", domain: "bus" });
    expect(t.issuer.kind).toBe("bus-operator");
  });

  it("reads its own sample: the ticket and the ride, on the stops' printed clocks", () => {
    expect(read(BUS_SOURCE)).toMatchObject({
      domain: "bus",
      bookingReference: "FBP-204711",
      price: 19.99,
      source: "workshop",
      rides: [
        {
          depName: "Probestadt ZOB",
          arrName: "Musterhafen ZOB",
          departureLocal: "2028-03-02T07:30",
          arrivalLocal: "2028-03-02T11:05",
          carrier: "N 42",
        },
      ],
    });
  });

  it("reads the next ticket: every ride, the return heading's day, an arrival past midnight", () => {
    const ticket = read(BUS_HELD_OUT);
    expect(ticket?.bookingReference).toBe("FBP-309922");
    expect(
      ticket?.rides.map((r) => [r.depName, r.departureLocal, r.arrivalLocal, r.carrier])
    ).toEqual([
      ["Beispielberg", "2028-04-10T09:15", "2028-04-10T10:40", "N 7"],
      ["Probestadt ZOB", "2028-04-10T11:00", "2028-04-10T14:25", "N 42"],
      ["Musterhafen ZOB", "2028-04-12T22:50", "2028-04-13T02:10", "N 43"],
    ]);
  });

  it("declines another operator's ticket", () => {
    expect(read(BUS_FOREIGN, "Dein Ticket – Reisebus Fernweh")).toBeNull();
  });

  it("abstains without a complete ride row, or without a day", () => {
    const without = (label: string) => BUS_SELECTIONS.filter((s) => s.label !== label);
    expect(deriveBusTemplate({ ...busInput, selections: without("arrStop") })).toEqual({
      ok: false,
      refusal: "rideNeedsRow",
    });
    expect(deriveBusTemplate({ ...busInput, selections: without("departureDate") })).toEqual({
      ok: false,
      refusal: "rideNeedsDate",
    });
  });

  it("abstains when nothing names the sender", () => {
    expect(deriveBusTemplate({ ...busInput, subject: "Deine Buchung" })).toEqual({
      ok: false,
      refusal: "noDistinguishingMarker",
    });
  });

  it("previews through the same consumer", () => {
    const own = previewTemplate("bus", userTemplate(busTemplate()), BUS_SUBJECT, BUS_SOURCE);
    expect(own.matched).toBe(true);
    expect(own.fields).toEqual(
      expect.arrayContaining([
        { name: "bookingReference", value: "FBP-204711" },
        {
          name: "rides",
          value: "2028-03-02T07:30 Probestadt ZOB→Musterhafen ZOB 2028-03-02T11:05 N 42",
        },
      ])
    );
    expect(previewTemplate("bus", userTemplate(busTemplate()), "x", BUS_FOREIGN).matched).toBe(
      false
    );
  });
});

describe("deriveFerryTemplate", () => {
  const read = (text: string, subject = FERRY_SUBJECT) =>
    applyV2RideTicketTemplate(ferryTemplate(), `${subject}\n${text}`);

  it("writes a ferry workshop envelope the shared schema accepts", () => {
    const t = ferryTemplate();
    expect(workshopEnvelopeSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ id: "ferry:user-td-ferry-1", domain: "ferry" });
    expect(t.issuer.kind).toBe("ferry-line");
  });

  it("reads every crossing with the day on its row and the vessel printed once for the ticket", () => {
    expect(read(FERRY_SOURCE)).toMatchObject({
      domain: "ferry",
      bookingReference: "IPS884213",
      price: 86,
      currency: null,
      rides: [
        {
          depName: "Probehafen",
          arrName: "Musterinsel",
          departureLocal: "2028-07-18T08:45",
          arrivalLocal: "2028-07-18T10:15",
          carrier: "MS Probewind",
        },
        {
          depName: "Musterinsel",
          arrName: "Probehafen",
          departureLocal: "2028-07-25T17:30",
          arrivalLocal: "2028-07-25T19:00",
          carrier: "MS Probewind",
        },
      ],
    });
  });

  it("reads the next ticket's vessel and a crossing past midnight", () => {
    const ticket = read(FERRY_HELD_OUT);
    expect(ticket?.rides).toEqual([
      {
        depName: "Probehafen",
        arrName: "Beispieloog",
        departureLocal: "2028-08-01T23:30",
        arrivalLocal: "2028-08-02T01:05",
        carrier: "MS Seebrise Probe",
      },
    ]);
  });

  it("declines another line's ticket", () => {
    expect(read(FERRY_FOREIGN, "Ticket – Nordfähre Fremdland")).toBeNull();
  });

  it("previews through the same consumer", () => {
    const own = previewTemplate(
      "ferry",
      userTemplate(ferryTemplate()),
      FERRY_SUBJECT,
      FERRY_SOURCE
    );
    expect(own.matched).toBe(true);
    expect(own.fields).toEqual(
      expect.arrayContaining([{ name: "bookingReference", value: "IPS884213" }])
    );
  });
});
