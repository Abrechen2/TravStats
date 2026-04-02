import { applyUserTemplate } from "../engine";
import type { UserTemplate } from "../types";

const REISEPLAN_TEMPLATE: UserTemplate = {
  id: "t1",
  userId: "u1",
  name: "Test Lufthansa",
  status: "active",
  fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
  patterns: {
    pnr: "Buchungscode:\\s*([A-Z0-9]{5,8})",
    useReiseplanSegments: true,
    detailsBlock:
      "([A-Z]{3})\\s+<https?://[^>]+>\\s+([A-Z]{3})[\\s\\S]{1,300}?(\\d{2}:\\d{2})\\s*\\n\\s*(\\d{2}:\\d{2})",
  },
  createdAt: "",
  updatedAt: "",
};

const SAMPLE_BODY = `From: noreply@lufthansa.com
Subject: Buchungsbestätigung

Buchungscode: ABCD12

Reiseplan

18.09.2025 - 08:25
Munich

18.09.2025 - 10:45
Helsinki
LH2460 Durchgeführt von: Lufthansa

19.09.2025 - 15:30
Helsinki

19.09.2025 - 17:50
Munich
LH2461 Durchgeführt von: Lufthansa

Buchungsdetails

MUC <https://example.com/arrow> HEL
08:25
10:45

HEL <https://example.com/arrow> MUC
15:30
17:50`;

describe("applyUserTemplate — Reiseplan mode", () => {
  it("extracts PNR from pattern", () => {
    const result = applyUserTemplate(REISEPLAN_TEMPLATE, "", SAMPLE_BODY);
    expect(result[0]?.pnr).toBe("ABCD12");
  });

  it("finds flights via Reiseplan segments", () => {
    const result = applyUserTemplate(REISEPLAN_TEMPLATE, "", SAMPLE_BODY);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("sets fieldSources.pnr to template for extracted PNR", () => {
    const result = applyUserTemplate(REISEPLAN_TEMPLATE, "", SAMPLE_BODY);
    expect(result[0]?.fieldSources?.pnr).toBe("template");
  });

  it("sets fieldSources.flightNumber to template for Reiseplan flights", () => {
    const result = applyUserTemplate(REISEPLAN_TEMPLATE, "", SAMPLE_BODY);
    expect(result[0]?.fieldSources?.flightNumber).toBe("template");
  });
});

const SIMPLE_TEMPLATE: UserTemplate = {
  id: "t2",
  userId: "u1",
  name: "Test Simple",
  status: "active",
  fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
  patterns: {
    pnr: "PNR:\\s*([A-Z0-9]{6})",
    flightNumber: "Flug:\\s*([A-Z]{2}\\d{1,4})",
    departureCode: "Von:\\s*([A-Z]{3})",
    arrivalCode: "Nach:\\s*([A-Z]{3})",
  },
  createdAt: "",
  updatedAt: "",
};

describe("applyUserTemplate — simple patterns", () => {
  it("extracts fields from simple labeled email", () => {
    const body = "PNR: AB1234\nFlug: LH123\nVon: MUC\nNach: FRA";
    const result = applyUserTemplate(SIMPLE_TEMPLATE, "", body);
    expect(result[0]?.pnr).toBe("AB1234");
    expect(result[0]?.flightNumber).toBe("LH123");
    expect(result[0]?.departureCode).toBe("MUC");
    expect(result[0]?.arrivalCode).toBe("FRA");
  });

  it("sets fieldSources.departureCode to template", () => {
    const body = "PNR: AB1234\nFlug: LH123\nVon: MUC\nNach: FRA";
    const result = applyUserTemplate(SIMPLE_TEMPLATE, "", body);
    expect(result[0]?.fieldSources?.departureCode).toBe("template");
  });

  it("returns one flight for simple single-flight email", () => {
    const body = "PNR: AB1234\nFlug: LH123\nVon: MUC\nNach: FRA";
    const result = applyUserTemplate(SIMPLE_TEMPLATE, "", body);
    expect(result).toHaveLength(1);
  });

  it("still returns one booking with empty fields when nothing matches", () => {
    const body = "nothing relevant here";
    const result = applyUserTemplate(SIMPLE_TEMPLATE, "", body);
    expect(result).toHaveLength(1);
    expect(result[0]?.pnr).toBeUndefined();
    expect(result[0]?.flightNumber).toBeUndefined();
    expect(result[0]?.departureCode).toBeUndefined();
  });
});
