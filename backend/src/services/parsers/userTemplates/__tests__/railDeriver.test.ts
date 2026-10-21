import { describe, it, expect } from "@jest/globals";
import { deriveRailTemplate } from "../railDeriver";
import { applyV2RailTemplate } from "../../../rail/parser/v2Rail";
import { workshopEnvelopeSchema } from "../../templates/v2/envelope";
import { previewTemplate } from "../preview";
import type { UserTemplate } from "../types";
import { select } from "./workshopSamples";
import {
  RAIL_FOREIGN,
  RAIL_HELD_OUT,
  RAIL_SELECTIONS,
  RAIL_SOURCE,
  RAIL_SUBJECT,
} from "./railSamples";

/**
 * forgejo#309 — the workshop derives a rail template: booking fields from
 * label patterns, every leg from ONE marked row, the day from the heading in
 * force above each leg. Run through the consumer the rail parser uses
 * (`v2Rail.ts`), never a test double.
 */
const input = {
  trainingDataId: "td-rail-1",
  subject: RAIL_SUBJECT,
  fullText: RAIL_SOURCE,
  selections: RAIL_SELECTIONS,
};

function derived() {
  const result = deriveRailTemplate(input);
  if (!result.ok) throw new Error(`derivation refused: ${result.refusal}`);
  return result.template;
}

const read = (text: string, subject = RAIL_SUBJECT) =>
  applyV2RailTemplate(derived(), `${subject}\n${text}`);

const without = (...labels: string[]) => RAIL_SELECTIONS.filter((s) => !labels.includes(s.label));

describe("deriveRailTemplate", () => {
  it("writes a rail workshop envelope the shared schema accepts", () => {
    const t = derived();
    expect(workshopEnvelopeSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ id: "rail:user-td-rail-1", domain: "rail" });
    expect(t.issuer.kind).toBe("rail");
  });

  it("reads its own sample: the booking and every leg, on the stations' printed clocks", () => {
    const booking = read(RAIL_SOURCE);
    expect(booking).toMatchObject({
      bookingReference: "PB4711XY",
      travelClass: "second",
      price: 23.4,
      source: "workshop",
    });
    expect(booking?.legs).toEqual([
      expect.objectContaining({
        depStationName: "Augsburg Hbf",
        arrStationName: "München Hbf",
        departureLocal: "2027-11-14T08:12",
        arrivalLocal: "2027-11-14T08:48",
        trainCategory: "RE",
        trainNumber: "89",
      }),
      expect.objectContaining({
        depStationName: "München Hbf",
        arrStationName: "München Flughafen Terminal",
        departureLocal: "2027-11-14T09:02",
        arrivalLocal: "2027-11-14T09:42",
        trainCategory: "S",
        trainNumber: "1",
      }),
    ]);
  });

  it("reads the same operator's next booking: the return heading dates the return leg, past midnight", () => {
    const booking = read(RAIL_HELD_OUT);
    expect(booking?.bookingReference).toBe("PB5822ZQ");
    expect(
      booking?.legs.map((l) => [l.depStationName, l.departureLocal, l.arrivalLocal, l.trainNumber])
    ).toEqual([
      ["Ulm Hbf", "2027-12-03T06:05", "2027-12-03T06:51", "57"],
      ["Augsburg Hbf", "2027-12-03T07:02", "2027-12-03T08:15", "1208"],
      // The return heading, not the outbound day; the arrival is the next day.
      ["Nürnberg Hbf", "2027-12-05T23:40", "2027-12-06T00:55", "2013"],
    ]);
  });

  it("leaves an arrival clock just before the departure's unread: a zone step, not the next day", () => {
    // Lille 09:30 (Paris) → London 09:00 (London) on one day, or a ride of
    // 23½ hours: a clock-only arrival cannot tell, so it is not guessed.
    const westward = RAIL_SOURCE.replace(
      "Augsburg Hbf  08:12  →  München Hbf  08:48",
      "Augsburg Hbf  09:30  →  München Hbf  09:00"
    );
    const leg = read(westward)?.legs[0];
    expect(leg?.departureLocal).toBe("2027-11-14T09:30");
    expect(leg?.arrivalLocal).toBeNull();
  });

  it("declines another operator's ticket", () => {
    expect(read(RAIL_FOREIGN, "Ihre Ticketbestätigung – Schienenfern Express")).toBeNull();
  });

  it("reads the day from the row itself when the row prints it", () => {
    const text = [
      "Probebahn Reisezentrum",
      "Auftragsnummer: PB1000AA",
      "",
      "Fahrplan",
      "21.01.2028  Kempten Hbf  12:10  →  Lindau-Reutin  13:20  RE 7",
      "21.01.2028  Lindau-Reutin  13:40  →  Bregenz  13:51  S 3",
    ].join("\n");
    const result = deriveRailTemplate({
      trainingDataId: "td-rail-row-day",
      subject: RAIL_SUBJECT,
      fullText: text,
      selections: [
        select(text, "PB1000AA", "bookingReference"),
        select(text, "21.01.2028", "departureDate"),
        select(text, "Kempten Hbf", "depStation"),
        select(text, "12:10", "departureTime"),
        select(text, "Lindau-Reutin", "arrStation"),
        select(text, "13:20", "arrivalTime"),
        select(text, "RE 7", "train"),
      ],
    });
    if (!result.ok) throw new Error(result.refusal);
    const booking = applyV2RailTemplate(result.template, `${RAIL_SUBJECT}\n${text}`);
    expect(booking?.legs.map((l) => `${l.departureLocal} ${l.depStationName}`)).toEqual([
      "2028-01-21T12:10 Kempten Hbf",
      "2028-01-21T13:40 Lindau-Reutin",
    ]);
  });

  it("abstains without a complete leg row, with the reason the page words", () => {
    expect(deriveRailTemplate({ ...input, selections: without("arrStation") })).toEqual({
      ok: false,
      refusal: "railNeedsLegRow",
    });
    expect(deriveRailTemplate({ ...input, selections: without("departureTime") })).toEqual({
      ok: false,
      refusal: "railNeedsLegRow",
    });
  });

  it("abstains without a day — a leg without one would be a guess", () => {
    expect(deriveRailTemplate({ ...input, selections: without("departureDate") })).toEqual({
      ok: false,
      refusal: "railNeedsDate",
    });
  });

  it("abstains when nothing names the sender", () => {
    expect(deriveRailTemplate({ ...input, subject: "Ihre Buchung" })).toEqual({
      ok: false,
      refusal: "noDistinguishingMarker",
    });
  });

  it("previews through the same consumer: legs and booking fields, nothing invented", () => {
    const template: UserTemplate = {
      id: "t-rail",
      userId: "u",
      name: "Probebahn",
      status: "pending",
      fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
      patterns: derived() as unknown as UserTemplate["patterns"],
      createdAt: "2027-01-01T00:00:00Z",
      updatedAt: "2027-01-01T00:00:00Z",
    };
    const own = previewTemplate("rail", template, RAIL_SUBJECT, RAIL_SOURCE);
    expect(own.matched).toBe(true);
    expect(own.fields).toEqual(
      expect.arrayContaining([
        { name: "bookingReference", value: "PB4711XY" },
        {
          name: "legs",
          value:
            "2027-11-14T08:12 Augsburg Hbf→München Hbf 2027-11-14T08:48 RE 89 · " +
            "2027-11-14T09:02 München Hbf→München Flughafen Terminal 2027-11-14T09:42 S 1",
        },
      ])
    );
    expect(previewTemplate("rail", template, "Fremd", RAIL_FOREIGN).matched).toBe(false);
  });
});
