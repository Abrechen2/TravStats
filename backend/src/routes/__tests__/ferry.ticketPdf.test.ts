jest.mock("../../services/documents/parseRetention", () => ({
  readDocumentForParse: jest.fn(async () => ({
    document: { format: "pdf" },
    buffer: Buffer.from("not a pdf"),
  })),
}));
jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: jest.fn(async () => {
    throw new Error("bad xref table");
  }),
}));
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { generateToken } from "../../utils/jwt";

describe("ferry ticket preview of an unreadable PDF", () => {
  let userId: string;
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "ferrypdffail" } });
    userId = (
      await prisma.user.create({ data: { username: "ferrypdffail", passwordHash: "unused" } })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers noText and logs why the PDF could not be read", async () => {
    // The extraction error was swallowed into an empty text: the user saw
    // "no text" and the log said nothing about the broken file.
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    const res = await request(app)
      .post("/api/v1/ferry/ticket-preview")
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .send({ documentId: "6f1c1b7e-3c1a-4e3e-9f61-6d0c8f5b2a10" });
    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe("noText");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "ferry.ticketPreview.pdf", error: "bad xref table" }),
      expect.any(String)
    );
    warn.mockRestore();
  });
});
