import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../lib/api", () => ({ uploadsApi: { uploadReceipt: vi.fn() }, API_URL: "" }));

import ReceiptUpload from "../ReceiptUpload";

const EXTRACT = { domain: "lodging" as const, current: {}, onApply: vi.fn() };
const DOCUMENT_URL = "/api/v1/documents/0b8f7f3e-1d2c-4c1b-9a55-3d1f6b7e2a10/file";

/**
 * A receipt is a kept document since forgejo#116, so its values can be read
 * by id — but only then: a legacy upload has no document behind it.
 */
describe("ReceiptUpload — take the values from the receipt", () => {
  it("offers it for a receipt kept as a document", () => {
    render(
      <ReceiptUpload
        currentReceiptUrl={DOCUMENT_URL}
        onUploadSuccess={vi.fn()}
        onDelete={vi.fn()}
        extract={EXTRACT}
      />
    );
    expect(screen.getByRole("button", { name: "documents:extract.action" })).toBeInTheDocument();
  });

  it("does not offer it for a legacy upload, or without a target", () => {
    const { rerender } = render(
      <ReceiptUpload
        currentReceiptUrl="/api/v1/uploads/receipts/abc.pdf"
        onUploadSuccess={vi.fn()}
        onDelete={vi.fn()}
        extract={EXTRACT}
      />
    );
    expect(screen.queryByRole("button", { name: "documents:extract.action" })).toBeNull();
    rerender(
      <ReceiptUpload
        currentReceiptUrl={DOCUMENT_URL}
        onUploadSuccess={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "documents:extract.action" })).toBeNull();
  });
});
