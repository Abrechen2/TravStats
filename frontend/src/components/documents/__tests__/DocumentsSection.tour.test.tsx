import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { TravelDocument } from "../../../lib/api/documents";
import { documentListPath } from "../../../lib/api/documents";
import { entryHref } from "../documentLinkUi";

/**
 * GitHub #415: a roadtrip keeps documents. Its list lives under `/tours/:id`, its link
 * points at the roadtrip page, and an image opens in the shared photo viewer.
 */
const api = vi.hoisted(() => ({
  listForEntry: vi.fn(),
  limits: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  links: vi.fn(),
  unlinkFromEntry: vi.fn(),
  addLinks: vi.fn(),
  linkCandidates: vi.fn(),
  tripCandidates: vi.fn(),
}));

vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return { ...actual, documentsApi: api };
});
vi.mock("../../../lib/api/entryTravellers", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/entryTravellers")>(
    "../../../lib/api/entryTravellers"
  );
  return {
    ...actual,
    entryTravellersApi: { list: vi.fn().mockResolvedValue([]), setFacts: vi.fn() },
  };
});
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import DocumentsSection from "../DocumentsSection";

const TOUR = { type: "tour", id: "r1" } as const;

const doc = (over: Partial<TravelDocument>): TravelDocument => ({
  id: "d1",
  format: "image",
  kind: null,
  mimetype: "image/png",
  sizeBytes: 1000,
  sha256: "abc",
  originalName: "ride.png",
  displayName: "ride.png",
  issuedOn: null,
  source: "upload",
  parsedDomain: null,
  entry: { type: "tour", id: "r1" },
  createdAt: "2026-09-18T10:00:00.000Z",
  linkedAt: null,
  url: "/api/v1/documents/d1/file",
  linkRole: "primary",
  evidenceFrom: null,
  linkCount: 1,
  ...over,
});

describe("documents on a roadtrip (GitHub #415)", () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    api.limits.mockResolvedValue({ image: 1, pdf: 1, eml: 1, emailText: 1, pkpass: 1 });
    api.links.mockResolvedValue([]);
    api.listForEntry.mockResolvedValue([doc({})]);
  });

  it("lists a roadtrip's documents under /tours and links back to the roadtrip page", () => {
    expect(documentListPath(TOUR)).toBe("/tours/r1/documents");
    expect(entryHref({ type: "tour", id: "r1", parentId: null })).toBe("/roadtrips/r1");
  });

  it("opens an image in the shared photo viewer when previewing is on", async () => {
    render(<DocumentsSection entry={TOUR} previewImages />);
    fireEvent.click(await screen.findByText("ride.png"));
    expect(await screen.findByTestId("photo-viewer")).toBeInTheDocument();
  });

  it("keeps the plain link (a new tab) when previewing is off", async () => {
    render(<DocumentsSection entry={TOUR} />);
    fireEvent.click(await screen.findByText("ride.png"));
    expect(screen.queryByTestId("photo-viewer")).not.toBeInTheDocument();
  });
});
