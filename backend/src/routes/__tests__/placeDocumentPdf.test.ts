import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();
jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
  isBcbpText: () => false,
}));

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { derivePlaceTemplate } from "../../services/parsers/userTemplates/placeDeriver";
import {
  PLACE_HELD_OUT,
  PLACE_SELECTIONS,
  PLACE_SOURCE,
  PLACE_SUBJECT,
} from "../../services/parsers/userTemplates/__tests__/workshopSamples";

/**
 * forgejo#124: a place PDF — a museum ticket — goes through the same PDF route
 * and text extraction as every other domain's document, read by the user's
 * active place template. Only the PDF text layer is mocked; the route, the
 * dispatch, detection and the template are real. Invented documents only.
 */
const PDF = Buffer.from("%PDF-1.4\n% place\n%%EOF");

describe("POST /api/v1/parse-pdf — a place document", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "placepdf" } });
    const user = await prisma.user.create({ data: { username: "placepdf", passwordHash: "x" } });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const derived = derivePlaceTemplate({
      trainingDataId: "td-place-pdf",
      subject: PLACE_SUBJECT,
      fullText: PLACE_SOURCE,
      selections: PLACE_SELECTIONS,
    });
    if (!derived.ok) throw new Error(`derivation refused: ${derived.refusal}`);
    await prisma.parserTemplate.create({
      data: {
        userId,
        domain: "place",
        name: "Museum am Probeufer",
        status: "active",
        fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
        patterns: derived.template as unknown as object,
      },
    });
  });

  beforeEach(() => extractTextFromPdf.mockReset());

  afterAll(async () => {
    await prisma.parserTemplate.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("reads a place ticket PDF into one import candidate", async () => {
    extractTextFromPdf.mockResolvedValue(PLACE_HELD_OUT);
    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF.toString("base64"), domain: "place" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      domain: "place",
      parserUsed: "template",
      candidates: [{ name: "Museum am Probeufer", visitedAt: "2027-11-02" }],
    });
    expect(res.body.pdfTextLength).toBe(PLACE_HELD_OUT.length);
  });

  it("recognises the same PDF under auto-detection", async () => {
    extractTextFromPdf.mockResolvedValue(PLACE_HELD_OUT);
    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF.toString("base64"), domain: "auto" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ domain: "place", domainSource: "detected" });
  });

  it("names an unreadable PDF and reads nothing", async () => {
    extractTextFromPdf.mockRejectedValueOnce(new Error("bad XRef entry"));
    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF.toString("base64"), domain: "place" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PDF");
  });
});
