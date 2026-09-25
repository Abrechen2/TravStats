import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { TravelDocument } from "../../../lib/api/documents";

const documentsApiMock = vi.hoisted(() => ({
  listForEntry: vi.fn(),
  limits: vi.fn(),
  extractValues: vi.fn(),
}));

vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return { ...actual, documentsApi: documentsApiMock };
});
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import DocumentsSection from "../DocumentsSection";

const doc = (id: string, format: TravelDocument["format"]): TravelDocument => ({
  id,
  format,
  kind: null,
  mimetype: "application/octet-stream",
  sizeBytes: 1000,
  sha256: id,
  originalName: `${id}.${format}`,
  displayName: `${id}.${format}`,
  issuedOn: null,
  source: "upload",
  parsedDomain: null,
  entry: { type: "flight", id: "f1" },
  createdAt: "2026-09-18T10:00:00.000Z",
  linkedAt: null,
  url: `/api/v1/documents/${id}/file`,
});

const EXTRACT = { domain: "flight" as const, current: {}, onApply: vi.fn() };

/**
 * The folder offers "take the values" only where it can work: on a document
 * the text parsers read, and only when the page said where the values go.
 */
describe("DocumentsSection — take the values from a document", () => {
  beforeEach(() => {
    documentsApiMock.listForEntry.mockResolvedValue([doc("bill", "pdf"), doc("photo", "image")]);
    documentsApiMock.limits.mockResolvedValue({});
  });

  it("offers it on a PDF and not on an image", async () => {
    render(<DocumentsSection entry={{ type: "flight", id: "f1" }} extract={EXTRACT} />);
    await screen.findByText("bill.pdf");
    expect(screen.getAllByRole("button", { name: "documents:extract.action" })).toHaveLength(1);
  });

  it("offers nothing when the entry has nowhere to put the values", async () => {
    render(<DocumentsSection entry={{ type: "flight", id: "f1" }} />);
    await screen.findByText("bill.pdf");
    expect(screen.queryByRole("button", { name: "documents:extract.action" })).toBeNull();
  });
});
