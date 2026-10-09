const extractTextFromPdf = jest.fn<Promise<string>, [Buffer]>();
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
import { templateRegistry } from "../../services/parsers/templates/registry";
import { loadDrafts, matchInput } from "../../services/trip/package/__tests__/draftTemplates";

/**
 * A tour operator's mail with its invoice attached, dropped into the trip
 * import with `retain` (P3 follow-up): the document kept is the invoice PDF
 * the package was read from, not the cover mail — it is what the trip is
 * filed with. Every value is invented.
 */
const drafts = loadDrafts();
const INVOICE_PDF = Buffer.from(`%PDF-1.4\n% package-invoice ${Date.now()}\n%%EOF`);

function emlWithInvoice(): Buffer {
  const boundary = "XYZ-package-boundary";
  return Buffer.from(
    [
      "From: Reiseveranstalter <service@veranstalter.example>",
      "Subject: Ihre Reiseunterlagen",
      "Date: Tue, 03 Mar 2026 10:00:00 +0100",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Sehr geehrte Damen und Herren, anbei erhalten Sie Ihre Unterlagen.",
      `--${boundary}`,
      'Content-Type: application/pdf; name="rechnung.pdf"',
      'Content-Disposition: attachment; filename="rechnung.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      INVOICE_PDF.toString("base64"),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
    "utf8"
  );
}

describe("POST /parse-email-file — a package read from the attachment", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: {
          username: `package-attachment-${Date.now()}`,
          passwordHash: await hashPassword("test-password"),
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(() => {
    extractTextFromPdf.mockReset();
    extractTextFromPdf.mockImplementation(async (buffer) =>
      buffer.equals(INVOICE_PDF) ? matchInput(drafts[0]) : ""
    );
    jest.spyOn(templateRegistry, "getActiveV2").mockReturnValue(drafts);
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("keeps the invoice PDF, not the mail, and records the reading on it", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email-file")
      .set("Cookie", cookie)
      .field("domain", "package")
      .field("retain", "true")
      .attach("email", emlWithInvoice(), "reiseunterlagen.eml");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      domain: "package",
      parserUsed: "template",
      package: { bookingReference: "9Z123456" },
      readFromAttachment: { filename: "rechnung.pdf" },
    });
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: res.body.documentId },
    });
    expect(document).toMatchObject({
      userId,
      format: "pdf",
      originalName: "rechnung.pdf",
      parsedDomain: "package",
    });
    expect(fs.readFileSync(documentPath(document.storedName)).equals(INVOICE_PDF)).toBe(true);
  });
});
