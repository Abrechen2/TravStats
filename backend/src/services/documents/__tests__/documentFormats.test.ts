import {
  DOCUMENT_SIZE_LIMITS,
  detectDocumentFormat,
  exceededLimit,
} from "../documentFormats";

/**
 * The format of a kept original comes from its bytes; the declaration only
 * breaks ties the bytes cannot (a ZIP that is a Wallet pass, text that is a
 * mail file). Limits are the owner's of 2026-09-16 (forgejo#116).
 */
const bytes = (...values: number[]): Buffer => Buffer.from(values);
const pad = (head: Buffer, size = 64): Buffer => Buffer.concat([head, Buffer.alloc(size)]);

describe("detectDocumentFormat", () => {
  it("reads images from their signature, whatever they claim to be", () => {
    expect(detectDocumentFormat(pad(bytes(0xff, 0xd8, 0xff)), "bill.pdf", "application/pdf")).toMatchObject({
      format: "image",
      mimetype: "image/jpeg",
    });
    expect(detectDocumentFormat(pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), undefined, undefined)?.mimetype).toBe(
      "image/png",
    );
    expect(
      detectDocumentFormat(pad(Buffer.concat([Buffer.from("RIFF"), bytes(0, 0, 0, 0), Buffer.from("WEBP")])), undefined, undefined)
        ?.mimetype,
    ).toBe("image/webp");
  });

  it("accepts HEIC, the iPhone camera's original", () => {
    const heic = pad(Buffer.concat([bytes(0, 0, 0, 0x18), Buffer.from("ftypheic")]));
    expect(detectDocumentFormat(heic, "IMG_0001.HEIC", "image/heic")).toMatchObject({ format: "image", mimetype: "image/heic" });
  });

  it("reads a PDF from %PDF", () => {
    expect(detectDocumentFormat(pad(Buffer.from("%PDF-1.7")), "x.bin", "application/octet-stream")?.format).toBe("pdf");
  });

  it("takes a ZIP as a Wallet pass only when it is declared as one", () => {
    const zip = pad(bytes(0x50, 0x4b, 0x03, 0x04));
    expect(detectDocumentFormat(zip, "boarding.pkpass", undefined)?.format).toBe("pkpass");
    expect(detectDocumentFormat(zip, "x", "application/vnd.apple.pkpass")?.format).toBe("pkpass");
    expect(detectDocumentFormat(zip, "archive.zip", "application/zip")).toBeNull();
  });

  it("tells a mail file from plain text by the declaration, and refuses binary posing as either", () => {
    const text = Buffer.from("From: hotel@example.invalid\nSubject: Rechnung\n\nTotal 162.75");
    expect(detectDocumentFormat(text, "rechnung.eml", undefined)?.format).toBe("eml");
    expect(detectDocumentFormat(text, undefined, "message/rfc822")?.format).toBe("eml");
    expect(detectDocumentFormat(text, undefined, "text/plain; charset=utf-8")?.format).toBe("emailText");
    expect(detectDocumentFormat(Buffer.concat([text, bytes(0)]), "rechnung.eml", undefined)).toBeNull();
    expect(detectDocumentFormat(text, "rechnung.docx", "application/msword")).toBeNull();
  });
});

describe("size limits", () => {
  it("are the owner's: image and pdf 10 MB, mail 2 MB, pkpass 5 MB", () => {
    const MB = 1024 * 1024;
    expect(DOCUMENT_SIZE_LIMITS).toEqual({ image: 10 * MB, pdf: 10 * MB, eml: 2 * MB, emailText: 2 * MB, pkpass: 5 * MB });
    expect(exceededLimit("eml", 2 * MB)).toBeNull();
    expect(exceededLimit("eml", 2 * MB + 1)).toBe(2 * MB);
  });
});
