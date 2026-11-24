import { describe, expect, it } from "vitest";

import { documentFilingHandoffOf } from "../documentFilingHandoff";

const file = new File(["%PDF"], "buchung.pdf", { type: "application/pdf" });
const valid = {
  documentId: "d1",
  openedAt: "2026-11-24T10:00:00Z",
  domain: "flight",
  document: { kind: "file", file },
};

describe("documentFilingHandoffOf", () => {
  it("accepts a document handed to an import domain", () => {
    expect(documentFilingHandoffOf({ documentFilingHandoff: valid })?.domain).toBe("flight");
  });

  it("refuses a domain with no import dialog, a text hand-off and anything malformed", () => {
    // Router state survives a reload and can be forged: only what the dialogs can take gets through.
    expect(
      documentFilingHandoffOf({ documentFilingHandoff: { ...valid, domain: "bus" } })
    ).toBeNull();
    expect(
      documentFilingHandoffOf({
        documentFilingHandoff: { ...valid, document: { kind: "text", text: "x" } },
      })
    ).toBeNull();
    expect(
      documentFilingHandoffOf({ documentFilingHandoff: { ...valid, documentId: 1 } })
    ).toBeNull();
    expect(documentFilingHandoffOf(null)).toBeNull();
  });
});
