import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";

const countPdfPages = jest.fn<(buffer: Buffer) => Promise<number | null>>();
jest.mock("../../services/pdfPageCount", () => ({
  countPdfPages: (buffer: Buffer) => countPdfPages(buffer),
}));

import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { pdfWithPages } from "../../services/__tests__/fixtures/pdfWithPages";

/**
 * forgejo#132 item 4: a kept PDF says how many pages it has ("2 Seiten"),
 * counted from its bytes at upload. Anything that is not a readable PDF answers
 * null — unknown — and never 0. The counting itself runs through the real PDF
 * reader in services/__tests__/pdfParser.pageCount.test.ts (pdf.js cannot load
 * inside Jest); here the reader is stubbed and the plumbing is pinned: what it
 * counts reaches the row and the answer, and only a PDF is ever handed to it.
 */

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

describe("the page count of a kept document", () => {
  const stamp = Date.now();
  let cookie: string;

  const upload = (buffer: Buffer, filename: string, contentType: string) =>
    request(app)
      .post("/api/v1/documents")
      .set("Cookie", cookie)
      .attach("file", buffer, { filename, contentType });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `page-count-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(() => countPdfPages.mockReset());

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { user: { username: `page-count-${stamp}` } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { username: `page-count-${stamp}` } });
  });

  it("counts the pages of an uploaded PDF", async () => {
    countPdfPages.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const res = await upload(pdfWithPages(2, `two-${stamp}`), "Rechnung.pdf", "application/pdf");
    expect(res.status).toBe(201);
    expect(res.body.data.pageCount).toBe(2);

    const one = await upload(pdfWithPages(1, `one-${stamp}`), "Beleg.pdf", "application/pdf");
    expect(one.body.data.pageCount).toBe(1);
    const row = await prisma.document.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.pageCount).toBe(2);
  });

  it("answers null, not 0, for a PDF whose pages cannot be read, and keeps it", async () => {
    countPdfPages.mockResolvedValueOnce(null);
    const res = await upload(
      Buffer.from(`%PDF-1.4\n% broken-${stamp}\n%%EOF`),
      "kaputt.pdf",
      "application/pdf"
    );
    expect(res.status).toBe(201);
    expect(res.body.data.pageCount).toBeNull();
  });

  it("answers null for an image, which has no page tree to count", async () => {
    const res = await upload(PNG_1x1, "foto.png", "image/png");
    expect(res.status).toBe(201);
    expect(res.body.data.pageCount).toBeNull();
    expect(countPdfPages).not.toHaveBeenCalled();
  });
});
