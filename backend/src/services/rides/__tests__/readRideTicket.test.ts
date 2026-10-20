jest.mock("../../parsers/userTemplates/v2UserTemplates", () => ({
  loadActiveWorkshopTemplates: jest.fn(),
}));

import { readRideTicket } from "../readRideTicket";
import { parseDocument } from "../../parsing/parseDocument";
import { loadActiveWorkshopTemplates } from "../../parsers/userTemplates/v2UserTemplates";
import { deriveBusTemplate, deriveFerryTemplate } from "../../parsers/userTemplates/rideDeriver";
import {
  BUS_HELD_OUT,
  BUS_SELECTIONS,
  BUS_SOURCE,
  BUS_SUBJECT,
  FERRY_HELD_OUT,
  FERRY_SELECTIONS,
  FERRY_SOURCE,
  FERRY_SUBJECT,
} from "../../parsers/userTemplates/__tests__/rideSamples";

/**
 * forgejo#309: a coach or ferry ticket is read by the caller's own ACTIVE
 * workshop template (after any repository template of the domain), and a
 * document nothing reads is declined with a code — never an empty success.
 */
const mockLoad = loadActiveWorkshopTemplates as jest.Mock;

function busTemplate() {
  const result = deriveBusTemplate({
    trainingDataId: "td-bus-parse",
    subject: BUS_SUBJECT,
    fullText: BUS_SOURCE,
    selections: BUS_SELECTIONS,
  });
  if (!result.ok) throw new Error(result.refusal);
  return result.template;
}

function ferryTemplate() {
  const result = deriveFerryTemplate({
    trainingDataId: "td-ferry-parse",
    subject: FERRY_SUBJECT,
    fullText: FERRY_SOURCE,
    selections: FERRY_SELECTIONS,
  });
  if (!result.ok) throw new Error(result.refusal);
  return result.template;
}

describe("readRideTicket", () => {
  beforeEach(() => mockLoad.mockReset());

  it("reads a bus ticket through the caller's active bus template", async () => {
    mockLoad.mockResolvedValue([busTemplate()]);
    const reading = await readRideTicket("bus", `${BUS_SUBJECT}\n${BUS_HELD_OUT}`, "user-1");
    expect(mockLoad).toHaveBeenCalledWith("user-1", "bus");
    expect(reading.ticket).toMatchObject({
      domain: "bus",
      bookingReference: "FBP-309922",
      templateId: "bus:user-td-bus-parse",
      source: "workshop",
    });
    expect(reading.ticket?.rides).toHaveLength(3);
  });

  it("asks for no workshop template without a user, and declines with noTemplate", async () => {
    const reading = await readRideTicket("ferry", FERRY_HELD_OUT, undefined);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(reading).toEqual({ ticket: null, fallbackCode: "noTemplate" });
  });

  it("says nothingRead when a template claims the ticket but reads no ride", async () => {
    mockLoad.mockResolvedValue([ferryTemplate()]);
    const noRows = `${FERRY_SUBJECT}\n${FERRY_SOURCE.split("\n").slice(0, 7).join("\n")}`;
    const reading = await readRideTicket("ferry", noRows, "user-1");
    expect(reading).toEqual({ ticket: null, fallbackCode: "nothingRead" });
  });
});

describe("parseDocument for bus and ferry", () => {
  beforeEach(() => mockLoad.mockReset());

  it("answers a ferry request with the ticket the workshop template read", async () => {
    mockLoad.mockResolvedValue([ferryTemplate()]);
    const outcome = await parseDocument({
      text: FERRY_HELD_OUT,
      subject: FERRY_SUBJECT,
      domain: "ferry",
      source: "email",
      userId: "user-1",
    });
    expect(outcome.domain).toBe("ferry");
    expect(outcome.domainSource).toBe("requested");
    expect(outcome.body).toMatchObject({
      domain: "ferry",
      parserUsed: "template",
      tickets: [{ bookingReference: "IPS990001" }],
    });
  });

  it("declines a bus request nothing reads with its code", async () => {
    mockLoad.mockResolvedValue([]);
    const outcome = await parseDocument({
      text: FERRY_HELD_OUT,
      domain: "bus",
      source: "document",
      userId: "user-1",
    });
    expect(outcome.body).toMatchObject({
      domain: "bus",
      tickets: [],
      parserUsed: "none",
      fallbackCode: "noTemplate",
    });
  });
});
