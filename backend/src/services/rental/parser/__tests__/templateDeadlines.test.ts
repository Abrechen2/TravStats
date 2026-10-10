import { validateEnvelope } from "../../../parsers/templates/v2/envelope";
import { applyV2RentalTemplate } from "../v2Rental";
import { toRentalCandidate } from "../rentalCandidates";
import type { ParsedRentalConfirmation } from "../types";

/**
 * forgejo#285: a rental template may read the booking's deadlines, and the
 * import candidate hands them to the create body in the shape the rental
 * route reads — the pickup station's wall clock, or a bare day. Invented data.
 */
jest.mock("../stationFromText", () => ({
  resolveStationFromText: jest.fn(async () => ({ status: "unresolved" })),
}));
jest.mock("../../../../db", () => ({
  prisma: { rentalBooking: { findFirst: jest.fn(async () => null) } },
}));

function template() {
  const result = validateEnvelope({
    id: "rental:example",
    domain: "rental",
    version: "1.0.0",
    issuer: { name: "Example Cars", kind: "other" },
    markets: [],
    match: { markers: ["example cars"], anchors: ["buchung"] },
    extraction: {
      fields: {
        kind: { value: "confirmation" },
        provider: { value: "Example Cars" },
        confirmationNumber: { patterns: ["Buchung (\\w+)"] },
        pickupStation: { patterns: ["Abholung: ([^\\n]+)"] },
        pickupLocal: { patterns: ["Ab: (\\S+)"] },
        returnStation: { patterns: ["Rückgabe: ([^\\n]+)"] },
        returnLocal: { patterns: ["Bis: (\\S+)"] },
        freeCancellationUntil: { patterns: ["Storno bis: (\\S+)"] },
        paymentDueOn: { patterns: ["Zahlung bis: (\\S+)"] },
      },
      required: ["confirmationNumber", "pickupStation", "pickupLocal"],
    },
    testCases: [
      { name: "m", input: "x", expect: "match" },
      { name: "d", input: "y", expect: "decline" },
    ],
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.template;
}

const MAIL = [
  "Example Cars — Buchung X1234",
  "Abholung: Musterstadt Flughafen",
  "Ab: 2027-06-01T10:00",
  "Rückgabe: Musterstadt Flughafen",
  "Bis: 2027-06-08T10:00",
  "Storno bis: 2027-05-31T12:00",
  "Zahlung bis: 2027-05-20",
].join("\n");

describe("rental templates — deadlines (forgejo#285)", () => {
  it("reads the deadlines and hands them to the create body", async () => {
    const read = applyV2RentalTemplate(template(), MAIL) as ParsedRentalConfirmation;
    expect(read).toMatchObject({
      freeCancellationUntil: "2027-05-31T12:00",
      paymentDueOn: "2027-05-20",
    });
    const candidate = await toRentalCandidate(read, "example", undefined);
    expect(candidate.input).toMatchObject({
      // A wall clock: the route places it on the pickup station's zone.
      freeCancellationUntil: { local: "2027-05-31T12:00" },
      paymentDueOn: "2027-05-20",
    });
  });

  it("passes a day-only cancellation on as the day", async () => {
    const read = applyV2RentalTemplate(
      template(),
      MAIL.replace("2027-05-31T12:00", "2027-05-31")
    ) as ParsedRentalConfirmation;
    const candidate = await toRentalCandidate(read, "example", undefined);
    expect(candidate.input?.freeCancellationUntil).toBe("2027-05-31");
  });

  it("adds no deadline keys when the document states none", async () => {
    const mail = MAIL.split("\n").slice(0, 5).join("\n");
    const read = applyV2RentalTemplate(template(), mail) as ParsedRentalConfirmation;
    const candidate = await toRentalCandidate(read, "example", undefined);
    expect(candidate.input).not.toHaveProperty("freeCancellationUntil");
    expect(candidate.input).not.toHaveProperty("paymentDueOn");
  });
});
