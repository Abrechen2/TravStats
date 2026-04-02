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
    const fullText =
      "IATA-Code des Abflughafens MUC\nIATA-Code des Ankunftsflughafens HEL";
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
  it("returns undefined when training data has no annotations", async () => {
    (prisma.trainingData.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const result = await deriveTemplateFromAnnotation("non-existent-id", "user1");
    expect(result).toBeUndefined();
  });

  it("returns undefined when annotations have no textSelections", async () => {
    (prisma.trainingData.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "td1",
      annotations: { fullText: "", textSelections: [] },
    });
    const result = await deriveTemplateFromAnnotation("td1", "user1");
    expect(result).toBeUndefined();
  });
});
