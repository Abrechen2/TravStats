/**
 * A tour operator's mail whose documents are only its PDF attachment (P3
 * follow-up): the body says "anbei Ihre Rechnung", the invoice is the PDF.
 * The PDF text layer is stubbed — each buffer names the text it "contains";
 * the invoice text is the invented Berge & Meer draft's own match case.
 */
const extractTextFromPdf = jest.fn<Promise<string>, [Buffer]>();
jest.mock("../../pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
}));
jest.mock("../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => false),
  recordLlmProbe: jest.fn(),
}));
jest.mock("../../llm/llmGate", () => ({
  ...jest.requireActual("../../llm/llmGate"),
  isLlmEnabledByAdmin: jest.fn(async () => true),
}));

import { parseDocument } from "../parseDocument";
import { templateRegistry } from "../../parsers/templates/registry";
import { prisma } from "../../../db";
import { loadDrafts, matchInput } from "../../trip/package/__tests__/draftTemplates";

const drafts = loadDrafts();
const [invoice] = drafts;

const COVER_NOTE = [
  "Sehr geehrte Damen und Herren,",
  "anbei erhalten Sie Ihre Unterlagen.",
  "Mit freundlichen Grüßen",
].join("\n");

const TEXTS: Record<string, string> = {
  "rechnung.pdf": matchInput(invoice),
  "agb.pdf": "Allgemeine Geschäftsbedingungen",
};

const pdf = (name: string) => ({
  filename: name,
  mediaType: "application/pdf",
  content: Buffer.from(name, "utf8"),
});

const mail = (
  domain: "package" | "auto",
  attachments: ReturnType<typeof pdf>[],
  text = COVER_NOTE
) =>
  parseDocument({
    text,
    subject: "Ihre Reiseunterlagen",
    domain,
    source: "email",
    userId: "u1",
    attachments,
  });

describe("parseDocument — a package in a mail's PDF attachment", () => {
  beforeEach(() => {
    extractTextFromPdf.mockReset();
    extractTextFromPdf.mockImplementation(async (buffer) => {
      const name = buffer.toString("utf8");
      if (name === "kaputt.pdf") throw new Error("Invalid PDF");
      return TEXTS[name] ?? "";
    });
    jest.spyOn(templateRegistry, "getActiveV2").mockReturnValue(drafts);
    jest.spyOn(prisma.userSettings, "findUnique").mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  it("reads the package from the attachment when the body reads nothing", async () => {
    const outcome = await mail("package", [pdf("agb.pdf"), pdf("rechnung.pdf")]);
    expect(outcome.body).toMatchObject({
      domain: "package",
      parserUsed: "template",
      template: { id: "package:berge-meer-invoice" },
      package: { bookingReference: "9Z123456" },
      readFromAttachment: { filename: "rechnung.pdf" },
    });
    // The bytes a retaining route keeps are the invoice's, not the mail's.
    expect(outcome.sourceAttachment?.filename).toBe("rechnung.pdf");
    expect(outcome.sourceAttachment?.content.toString("utf8")).toBe("rechnung.pdf");
  });

  it("takes the first attachment that reads, and skips one that cannot be opened", async () => {
    const outcome = await mail("package", [
      pdf("kaputt.pdf"),
      pdf("rechnung.pdf"),
      { ...pdf("rechnung.pdf"), filename: "kopie.pdf" },
    ]);
    expect(outcome.sourceAttachment?.filename).toBe("rechnung.pdf");
  });

  it("opens no attachment when the body already reads as a package", async () => {
    const outcome = await mail("package", [pdf("rechnung.pdf")], matchInput(invoice));
    expect(outcome.body).toMatchObject({ parserUsed: "template" });
    expect(outcome.body).not.toHaveProperty("readFromAttachment");
    expect(outcome.sourceAttachment).toBeUndefined();
    expect(extractTextFromPdf).not.toHaveBeenCalled();
  });

  it("opens no attachment while no package template is active", async () => {
    jest.spyOn(templateRegistry, "getActiveV2").mockReturnValue([]);
    const outcome = await mail("package", [pdf("rechnung.pdf")]);
    expect(outcome.body).toMatchObject({ package: null, fallbackCode: "noTemplate" });
    expect(extractTextFromPdf).not.toHaveBeenCalled();
  });

  it("still says noTemplate when no attachment is a package", async () => {
    const outcome = await mail("package", [pdf("agb.pdf")]);
    expect(outcome.body).toMatchObject({ package: null, fallbackCode: "noTemplate" });
    expect(outcome.sourceAttachment).toBeUndefined();
  });

  it("lets auto detection choose package from the attachment, and opens it once", async () => {
    const outcome = await mail("auto", [pdf("rechnung.pdf")]);
    expect(outcome.domain).toBe("package");
    expect(outcome.domainSource).toBe("detected");
    expect(outcome.detection?.candidates[0].matched).toContain(
      "package-template:package:berge-meer-invoice"
    );
    expect(outcome.body).toMatchObject({ package: { bookingReference: "9Z123456" } });
    expect(extractTextFromPdf).toHaveBeenCalledTimes(1);
  });
});
