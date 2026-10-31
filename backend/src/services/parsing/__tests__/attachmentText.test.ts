import { extractAttachmentText } from "../attachmentText";
import { extractTextFromPdf } from "../../pdfParser";

jest.mock("../../pdfParser", () => ({ extractTextFromPdf: jest.fn() }));
const extract = extractTextFromPdf as jest.MockedFunction<typeof extractTextFromPdf>;

describe("extractAttachmentText (forgejo#383 PERF-30)", () => {
  beforeEach(() => extract.mockReset());

  it("opens one PDF once however many readers ask for its text", async () => {
    extract.mockResolvedValue("ticket text");
    const pdf = Buffer.from("%PDF-1.4 a");
    const texts = await Promise.all([
      extractAttachmentText(pdf),
      extractAttachmentText(pdf),
      extractAttachmentText(pdf),
    ]);
    expect(texts).toEqual(["ticket text", "ticket text", "ticket text"]);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("keeps different attachments apart", async () => {
    extract.mockImplementation(async (b) => b.toString());
    expect(await extractAttachmentText(Buffer.from("%PDF one"))).toBe("%PDF one");
    expect(await extractAttachmentText(Buffer.from("%PDF two"))).toBe("%PDF two");
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("hands every reader the same failure instead of retrying the broken PDF", async () => {
    extract.mockRejectedValue(new Error("PDF text extraction failed"));
    const pdf = Buffer.from("%PDF broken");
    await expect(extractAttachmentText(pdf)).rejects.toThrow("PDF text extraction failed");
    await expect(extractAttachmentText(pdf)).rejects.toThrow("PDF text extraction failed");
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
