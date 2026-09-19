import { describe, it, expect } from "vitest";

import { DOCUMENT_FORMATS } from "../../../lib/api/documents";
import {
  DOCUMENT_FORMAT_ICON,
  exceededDocumentLimit,
  guessDocumentFormat,
} from "../documentDisplay";

const LIMITS = {
  image: 10 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  eml: 2 * 1024 * 1024,
  emailText: 2 * 1024 * 1024,
  pkpass: 5 * 1024 * 1024,
};

function file(name: string, type: string, size = 1): File {
  const made = new File(["x"], name, { type });
  Object.defineProperty(made, "size", { value: size });
  return made;
}

describe("DOCUMENT_FORMAT_ICON", () => {
  it("has an icon for every format the server accepts", () => {
    // A missing entry renders `LUCIDE[undefined]` and throws at the row that
    // carries the new format — the one row a user would have uploaded.
    for (const format of DOCUMENT_FORMATS) expect(DOCUMENT_FORMAT_ICON[format]).toBeTruthy();
  });
});

describe("guessDocumentFormat", () => {
  it("reads the MIME type where a browser sets a useful one", () => {
    expect(guessDocumentFormat(file("boarding.pdf", "application/pdf"))).toBe("pdf");
    expect(guessDocumentFormat(file("scan.heic", "image/heic"))).toBe("image");
    expect(guessDocumentFormat(file("mail.eml", "message/rfc822"))).toBe("eml");
    expect(guessDocumentFormat(file("pass.pkpass", "application/vnd.apple.pkpass"))).toBe("pkpass");
  });

  it("falls back to the extension, which is all Windows offers for .eml and .pkpass", () => {
    expect(guessDocumentFormat(file("mail.eml", ""))).toBe("eml");
    expect(guessDocumentFormat(file("pass.pkpass", ""))).toBe("pkpass");
    expect(guessDocumentFormat(file("mail.txt", "text/plain"))).toBe("emailText");
  });

  it("abstains rather than guessing, so the server decides", () => {
    expect(guessDocumentFormat(file("holiday.zip", "application/zip"))).toBeNull();
  });
});

describe("exceededDocumentLimit", () => {
  it("measures against the guessed format's own limit", () => {
    expect(exceededDocumentLimit(file("m.eml", "message/rfc822", 3_000_000), LIMITS)).toBe(
      LIMITS.eml
    );
    expect(exceededDocumentLimit(file("m.eml", "message/rfc822", 1_000_000), LIMITS)).toBeNull();
    expect(exceededDocumentLimit(file("p.pdf", "application/pdf", 3_000_000), LIMITS)).toBeNull();
  });

  it("refuses nothing when the limits are unknown — the rule is the server's", () => {
    expect(exceededDocumentLimit(file("p.pdf", "application/pdf", 999_000_000), null)).toBeNull();
  });
});
