import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();
const llmGenerateChain = jest.fn<(req: unknown) => Promise<{ text: string; target: unknown }>>();
const llmRefusalFor =
  jest.fn<(userId?: string) => Promise<{ kind: string; reason: string } | null>>();

jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
  isBcbpText: () => false,
}));
jest.mock("../../services/llm/llmProvider", () => ({
  ...jest.requireActual<object>("../../services/llm/llmProvider"),
  llmGenerateChain: (req: unknown) => llmGenerateChain(req),
}));
jest.mock("../../services/llm/llmGate", () => ({
  ...jest.requireActual<object>("../../services/llm/llmGate"),
  llmRefusalFor: (userId?: string) => llmRefusalFor(userId),
  isLlmEnabledByAdmin: jest.fn(async () => true),
}));
jest.mock("../../services/parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => true),
  recordLlmProbe: jest.fn(),
}));

import fs from "fs";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { templateRegistry } from "../../services/parsers/templates/registry";

/**
 * Trip import: a package document no template knows, read by the model on the
 * user's request, becomes ONE trip with its flights and stays and the original
 * filed on it (spec 2026-08-21, "As built"). Failures keep their reason.
 */
const stamp = Date.now();
const REF = `ZX${stamp}`.slice(0, 14);
const DOC_TEXT = [
  `Reisebestaetigung Nr. ${REF}`,
  "Ausgestellt am 02.02.2026",
  "Hinflug ET0707 am 14.04.2026 Frankfurt 21:35 - Addis Abeba 06:25",
  "Rueckflug ET0708 am 26.04.2026 Nairobi - Frankfurt",
  "Hotel Seeblick Muster, Naivasha, 19.04.2026 - 26.04.2026",
  "Gesamtpreis 2.899,00 EUR",
].join("\n");

const modelAnswer = {
  bookingReference: REF,
  issuedOn: "2026-02-02",
  tripName: "Kenia Rundreise",
  totalPrice: 2899,
  currency: "EUR",
  flights: [
    { flightNumber: "ET707", date: "2026-04-14", depIata: "FRA", arrIata: "ADD", depTime: "21:35" },
    { flightNumber: "XX999", date: "2026-04-20", depIata: "ADD", arrIata: "NBO" },
  ],
  stays: [{ name: "Hotel Seeblick Muster", checkIn: "2026-04-19", checkOut: "2026-04-26" }],
};

describe("package document read by the model on request", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `pkgm-${stamp}`, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(() => {
    jest.spyOn(templateRegistry, "getActiveV2").mockReturnValue([]);
    extractTextFromPdf.mockReset().mockResolvedValue(DOC_TEXT);
    llmGenerateChain.mockReset();
    llmRefusalFor.mockReset().mockResolvedValue(null);
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const pdf = Buffer.from(`%PDF-1.4\n% ${stamp}\n%%EOF`).toString("base64");
  const parse = (extra: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ domain: "package", ...extra });

  it("never asks the model unless the user did: an unknown operator stays 'no template'", async () => {
    const res = await parse({ pdfBase64: pdf }).expect(200);
    expect(res.body).toMatchObject({ package: null, fallbackCode: "noTemplate" });
    expect(llmGenerateChain).not.toHaveBeenCalled();
  });

  it("turns a multi-entry document into one trip with its entries and the original attached", async () => {
    llmGenerateChain.mockResolvedValue({ text: JSON.stringify(modelAnswer), target: {} });
    const kept = await parse({ pdfBase64: pdf, retain: true }).expect(200);
    const documentId = kept.body.documentId as string;
    expect(kept.body.package).toBeNull();

    const read = await parse({ documentId, packageModel: true }).expect(200);
    expect(read.body).toMatchObject({
      parserUsed: "ollama",
      package: { bookingReference: REF, totalPrice: 2899 },
    });
    expect(read.body.package.flights.map((f: { flightNumber: string }) => f.flightNumber)).toEqual([
      "ET707",
    ]);
    // The invented flight is refused AND said, not silently thinned out.
    expect(read.body.modelDropped).toEqual([{ kind: "flight", value: "XX999" }]);

    const before = await prisma.trip.count({ where: { userId } });
    expect(before).toBe(0);
    const preview = await request(app)
      .post("/api/v1/trips/package/preview")
      .set("Cookie", cookie)
      .send({ documentId })
      .expect(200);
    expect(preview.body.data.proposal.trip.action).toBe("create");
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);

    const commit = await request(app)
      .post("/api/v1/trips/package/commit")
      .set("Cookie", cookie)
      .send({ documentId })
      .expect(201);
    expect(commit.body.success).toBe(true);
    const trips = await prisma.trip.findMany({ where: { userId } });
    expect(trips).toHaveLength(1);
    expect(await prisma.flight.count({ where: { userId, tripId: trips[0].id } })).toBe(1);
    expect(await prisma.lodgingStay.count({ where: { userId, tripId: trips[0].id } })).toBe(1);
    const filed = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(filed.tripId).toBe(trips[0].id);
  });

  it("says why a provider failure produced no reading, instead of an empty success", async () => {
    llmGenerateChain.mockRejectedValue(
      new Error(
        "connect ECONNREFUSED 192.168.178.155:11434 (http://192.168.178.155:11434/api/generate)"
      )
    );
    const res = await parse({ pdfBase64: pdf, packageModel: true }).expect(200);
    expect(res.body).toMatchObject({
      package: null,
      parserUsed: "none",
      fallbackCode: "modelFailed",
      modelReason: "LLM_UNREACHABLE",
    });
    // The internal address stays in the server log, never in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/192\.168|11434|ECONNREFUSED/);
  });

  it("reports an admin or consent refusal with its reason and never reaches the provider", async () => {
    llmRefusalFor.mockResolvedValue({ kind: "disabled_by_admin", reason: "AI parser is off" });
    const res = await parse({ pdfBase64: pdf, packageModel: true }).expect(200);
    expect(res.body).toMatchObject({
      package: null,
      fallbackCode: "modelRefused",
      modelReason: "disabled_by_admin",
    });
    expect(llmGenerateChain).not.toHaveBeenCalled();
  });

  it("refuses an answer that does not satisfy the contract and names the paths", async () => {
    llmGenerateChain.mockResolvedValue({
      text: JSON.stringify({ bookingReference: REF, flights: [], stays: [] }),
      target: {},
    });
    const res = await parse({ pdfBase64: pdf, packageModel: true }).expect(200);
    expect(res.body).toMatchObject({ package: null, fallbackCode: "modelInvalid" });
    expect(res.body.issues).toEqual([expect.stringContaining("issuedOn")]);
  });

  it("does not accept a price that is only a digit run inside the stated amount", async () => {
    llmGenerateChain.mockResolvedValue({
      text: JSON.stringify({ ...modelAnswer, totalPrice: 899 }),
      target: {},
    });
    const res = await parse({ pdfBase64: pdf, packageModel: true }).expect(200);
    expect(res.body.package.totalPrice).toBeNull();
    expect(res.body.modelDropped).toContainEqual({ kind: "price", value: "899" });
  });

  it("refuses an answer whose flights are not a list instead of reading it as none", async () => {
    llmGenerateChain.mockResolvedValue({
      text: JSON.stringify({ ...modelAnswer, flights: { flightNumber: "ET707" } }),
      target: {},
    });
    const res = await parse({ pdfBase64: pdf, packageModel: true }).expect(200);
    expect(res.body).toMatchObject({ package: null, fallbackCode: "modelInvalid" });
    expect(res.body.issues).toEqual([expect.stringContaining("flights")]);
  });

  it("refuses a document longer than the model is shown, rather than reading part of it", async () => {
    extractTextFromPdf.mockResolvedValue(`${DOC_TEXT}\n${"x ".repeat(9000)}`);
    const res = await parse({ pdfBase64: pdf, packageModel: true }).expect(200);
    expect(res.body).toMatchObject({ package: null, fallbackCode: "modelInvalid" });
    expect(llmGenerateChain).not.toHaveBeenCalled();
  });
});
