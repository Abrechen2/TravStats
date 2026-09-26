import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();
jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
  isBcbpText: () => false,
}));

import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";
import { DB_NEWSLETTER, DB_ONLINE_TICKET } from "../../services/rail/parser/__tests__/railFixtures";

/**
 * "Werte aus dem Beleg übernehmen" for a rail journey: the kept ticket's
 * total, currency, order number and class, and — only for the leg the entry
 * is — its coach and seat. The rail parser runs for real; only the PDF text
 * layer is stubbed.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("POST /documents/:id/extract-values — rail", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  const previousOllama = process.env.OLLAMA_URL;

  const extract = (id: string, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/documents/${id}/extract-values`).set("Cookie", cookie).send(body);
  const keptPdf = async (tag: string) =>
    (await createDocument({ userId, buffer: PDF(`${tag}-${stamp}`) })).document.id;

  beforeAll(async () => {
    process.env.OLLAMA_URL = "http://127.0.0.1:9";
    userId = (
      await prisma.user.create({
        data: {
          username: `extract-rail-${stamp}`,
          passwordHash: await hashPassword("test-password"),
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(() => {
    extractTextFromPdf.mockReset();
    extractTextFromPdf.mockResolvedValue(DB_ONLINE_TICKET);
  });

  afterAll(async () => {
    process.env.OLLAMA_URL = previousOllama;
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("proposes the total, reference, class, and the coach and seat of the entry's own train", async () => {
    const res = await extract(await keptPdf("leg"), {
      domain: "rail",
      trainNumber: "IC 2217",
      departureDate: "2016-05-02",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      domain: "rail",
      parserUsed: "template",
      values: {
        price: 122.5,
        currency: "EUR",
        bookingReference: "Q7X2KT",
        travelClass: "second",
        coach: "7",
        seatNumber: "45",
      },
    });
  });

  it("abstains on coach and seat when the leg cannot be told, keeping the booking's values", async () => {
    const res = await extract(await keptPdf("noleg"), { domain: "rail" });

    expect(res.body.data.values).toMatchObject({
      price: 122.5,
      bookingReference: "Q7X2KT",
      coach: null,
      seatNumber: null,
    });
  });

  it("says nothing was found in a rail mail that is not a booking", async () => {
    extractTextFromPdf.mockResolvedValue(DB_NEWSLETTER);
    const res = await extract(await keptPdf("newsletter"), { domain: "rail" });

    expect(res.body.data).toMatchObject({ values: null, reason: "nothingFound" });
  });
});
