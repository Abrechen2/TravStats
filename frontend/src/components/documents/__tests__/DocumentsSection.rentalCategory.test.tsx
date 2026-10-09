import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TravelDocument } from "../../../lib/api/documents";

/**
 * forgejo#239: a rental's hand-over evidence grouped by what it shows, each
 * document re-filed in place, an upload filed under a category at once — the
 * same documents, nothing copied; old attachments stay "Ohne Kategorie".
 */
const documentsApiMock = vi.hoisted(() => ({
  listForEntry: vi.fn(),
  limits: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  setRentalCategory: vi.fn(),
}));
const isDemoMock = vi.hoisted(() => ({ current: false }));

vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return {
    ...actual,
    documentsApi: documentsApiMock,
  };
});
vi.mock("../../../hooks/useIsDemoAccount", () => ({
  useIsDemoAccount: () => isDemoMock.current,
}));

import DocumentsSection from "../DocumentsSection";

const LIMITS = {
  image: 10 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  eml: 2 * 1024 * 1024,
  emailText: 2 * 1024 * 1024,
  pkpass: 5 * 1024 * 1024,
};

function makeDocument(over: Partial<TravelDocument> = {}): TravelDocument {
  return {
    id: "d1",
    format: "pdf",
    kind: "boardingPass",
    mimetype: "application/pdf",
    sizeBytes: 25_000,
    sha256: "abc",
    originalName: "LH2462.pdf",
    displayName: "LH2462.pdf",
    issuedOn: "2026-09-18",
    source: "upload",
    parsedDomain: null,
    entry: { type: "flight", id: "f1" },
    createdAt: "2026-09-18T10:00:00.000Z",
    linkedAt: "2026-09-18T10:00:00.000Z",
    url: "/api/v1/documents/d1/file",
    ...over,
  };
}

const RENTAL = { type: "rentalBooking", id: "r1" } as const;

describe("DocumentsSection — rental categories", () => {
  beforeEach(() => {
    isDemoMock.current = false;
    documentsApiMock.listForEntry
      .mockReset()
      .mockResolvedValue([
        makeDocument({ id: "a", displayName: "kratzer.jpg", rentalCategory: "damage" }),
        makeDocument({ id: "b", displayName: "alt.pdf" }),
        makeDocument({ id: "c", displayName: "tacho.jpg", rentalCategory: "odometer" }),
      ]);
    documentsApiMock.limits.mockReset().mockResolvedValue(LIMITS);
    documentsApiMock.upload.mockReset().mockResolvedValue(makeDocument());
    documentsApiMock.setRentalCategory.mockReset();
  });

  it("groups the evidence by category, with the old attachments uncategorised", async () => {
    render(<DocumentsSection entry={RENTAL} rentalCategories />);
    expect(await screen.findByTestId("documents-group-damage")).toBeTruthy();
    expect(screen.getByTestId("documents-group-odometer")).toBeTruthy();
    expect(screen.getByTestId("documents-group-none")).toBeTruthy();
    // Empty groups are not drawn.
    expect(screen.queryByTestId("documents-group-fuel")).toBeNull();
    // Each one still opens directly.
    expect(screen.getAllByRole("link", { name: "documents:openLabel" })).toHaveLength(3);
  });

  it("re-files a document in place and moves it to its new group", async () => {
    documentsApiMock.setRentalCategory.mockResolvedValue(
      makeDocument({ id: "b", displayName: "alt.pdf", rentalCategory: "fuel" })
    );
    render(<DocumentsSection entry={RENTAL} rentalCategories />);
    const selects = await screen.findAllByRole("combobox", {
      name: "documents:rentalCategory.rowLabel",
    });
    // Rows in group order: damage (a), odometer (c), none (b).
    fireEvent.change(selects[2], { target: { value: "fuel" } });
    await waitFor(() => expect(screen.getByTestId("documents-group-fuel")).toBeTruthy());
    expect(documentsApiMock.setRentalCategory).toHaveBeenCalledWith("b", "fuel");
    expect(documentsApiMock.upload).not.toHaveBeenCalled();
  });

  it("says when a re-filing fails, and keeps the old group", async () => {
    documentsApiMock.setRentalCategory.mockRejectedValue(new Error("down"));
    render(<DocumentsSection entry={RENTAL} rentalCategories />);
    const selects = await screen.findAllByRole("combobox", {
      name: "documents:rentalCategory.rowLabel",
    });
    fireEvent.change(selects[2], { target: { value: "fuel" } });
    expect(await screen.findByText("documents:rentalCategory.saveFailed")).toBeTruthy();
    expect(screen.queryByTestId("documents-group-fuel")).toBeNull();
  });

  it("files an upload under the chosen category", async () => {
    render(<DocumentsSection entry={RENTAL} rentalCategories />);
    await screen.findByTestId("documents-group-none");
    fireEvent.change(
      screen.getByRole("combobox", { name: "documents:rentalCategory.uploadLabel" }),
      {
        target: { value: "pickup" },
      }
    );
    const file = new File(["x"], "abholung.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("documents-file-input"), { target: { files: [file] } });
    await waitFor(() => expect(documentsApiMock.upload).toHaveBeenCalled());
    expect(documentsApiMock.upload.mock.calls[0][0]).toMatchObject({ rentalCategory: "pickup" });
  });

  it("says when the same file was already filed under another category", async () => {
    documentsApiMock.upload.mockResolvedValue(
      makeDocument({ id: "a", displayName: "kratzer.jpg", rentalCategory: "damage" })
    );
    render(<DocumentsSection entry={RENTAL} rentalCategories />);
    await screen.findByTestId("documents-group-none");
    fireEvent.change(
      screen.getByRole("combobox", { name: "documents:rentalCategory.uploadLabel" }),
      { target: { value: "fuel" } }
    );
    const file = new File(["x"], "kratzer.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("documents-file-input"), { target: { files: [file] } });
    expect((await screen.findByTestId("documents-notice")).textContent).toBe(
      "documents:rentalCategory.alreadyFiled"
    );
  });

  it("offers no categories on any other entry", async () => {
    render(<DocumentsSection entry={{ type: "flight", id: "f1" }} />);
    await waitFor(() => expect(documentsApiMock.listForEntry).toHaveBeenCalled());
    expect(
      screen.queryByRole("combobox", { name: "documents:rentalCategory.uploadLabel" })
    ).toBeNull();
  });
});
