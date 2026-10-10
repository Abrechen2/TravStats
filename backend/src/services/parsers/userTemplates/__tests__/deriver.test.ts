jest.mock("../../../../db", () => ({
  prisma: {
    trainingData: {
      findUnique: jest.fn(),
    },
    parserTemplate: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { derivePatternFromSelection, extractFingerprint } from "../deriver";
import { prisma } from "../../../../db";
import { deriveTemplateFromAnnotation } from "../deriver";
import { parseWorkshopEnvelope } from "../v2UserTemplates";
import {
  CRUISE_SELECTIONS,
  CRUISE_SOURCE,
  CRUISE_SUBJECT,
  PLACE_SELECTIONS,
  PLACE_SOURCE,
} from "./workshopSamples";

describe("derivePatternFromSelection", () => {
  it("extracts context-anchored regex for a PNR field", () => {
    const fullText = "Buchungscode: ABCD12\nSomething else";
    const pattern = derivePatternFromSelection(
      { text: "ABCD12", label: "pnr", start: 14, end: 20 },
      fullText
    );
    expect(pattern).toBeTruthy();
    const re = new RegExp(pattern!);
    expect(re.test(fullText)).toBe(true);
  });

  it("extracts context-anchored regex for a 3-letter IATA code", () => {
    const fullText = "IATA-Code des Abflughafens MUC\nIATA-Code des Ankunftsflughafens HEL";
    const pattern = derivePatternFromSelection(
      { text: "MUC", label: "departureCode", start: 27, end: 30 },
      fullText
    );
    expect(pattern).toBeTruthy();
    const re = new RegExp(pattern!);
    const m = re.exec(fullText);
    expect(m?.[1]).toBe("MUC");
  });

  it("returns undefined for empty annotated text", () => {
    const result = derivePatternFromSelection(
      { text: "", label: "pnr", start: 0, end: 0 },
      "some text"
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown field label", () => {
    const result = derivePatternFromSelection(
      { text: "1A", label: "seatNumber", start: 5, end: 7 },
      "Seat: 1A"
    );
    expect(result).toBeUndefined();
  });
});

describe("extractFingerprint", () => {
  it("extracts sender domain from From header", () => {
    const fullText =
      "From: noreply@noti.swiss.com\nSubject: Buchungsbestätigung\nBody text with Buchungsübersicht";
    const fp = extractFingerprint(fullText, "Buchungsbestätigung");
    expect(fp.senderDomains).toContain("noti.swiss.com");
    expect(fp.subjectPatterns).toContain("Buchungsbestätigung");
    expect(fp.bodyMarkers.length).toBeGreaterThan(0);
  });
});

describe("deriveTemplateFromAnnotation", () => {
  it("fails, and says so, when there is no training data", async () => {
    (prisma.trainingData.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const result = await deriveTemplateFromAnnotation("non-existent-id", "user1");
    // An outcome, not `undefined`: the caller renders the reason, which is
    // the whole point of phase 6's abstention vocabulary.
    expect(result).toEqual({ status: "failed", reason: "noAnnotations" });
  });

  it("fails when the annotations carry no selections", async () => {
    (prisma.trainingData.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "td1",
      domain: "flight",
      annotations: { fullText: "", textSelections: [] },
    });
    const result = await deriveTemplateFromAnnotation("td1", "user1");
    expect(result).toEqual({ status: "failed", reason: "noAnnotations" });
  });

  it("abstains for a place annotation without a name, and writes nothing", async () => {
    (prisma.trainingData.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "td2",
      domain: "place",
      annotations: {
        fullText: PLACE_SOURCE,
        textSelections: PLACE_SELECTIONS.filter((s) => s.label !== "name"),
      },
    });
    const result = await deriveTemplateFromAnnotation("td2", "user1");
    expect(result).toEqual({ status: "abstained", domain: "place", reason: "placeNeedsName" });
    expect(prisma.parserTemplate.create).not.toHaveBeenCalled();
  });

  it("writes a cruise annotation as a PENDING cruise template holding a v2 envelope", async () => {
    (prisma.trainingData.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "td3",
      domain: "cruise",
      subject: CRUISE_SUBJECT,
      senderAddress: null,
      annotations: { fullText: CRUISE_SOURCE, textSelections: CRUISE_SELECTIONS },
    });
    (prisma.parserTemplate.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.parserTemplate.create as jest.Mock).mockResolvedValueOnce({ id: "tpl-cruise" });

    const result = await deriveTemplateFromAnnotation("td3", "user1");

    expect(result).toEqual({ status: "derived", templateId: "tpl-cruise", domain: "cruise" });
    const data = (prisma.parserTemplate.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ domain: "cruise", status: "pending", sourceId: "td3" });
    expect(parseWorkshopEnvelope(data.patterns, "cruise")?.id).toBe("cruise:user-td3");
    // The same row can never pass for a place template.
    expect(parseWorkshopEnvelope(data.patterns, "place")).toBeNull();
  });
});
