import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TravelDocument } from "../../../lib/api/documents";

/**
 * The surface the 2.7.0 what's-new promised and the web did not have.
 *
 * Every case mocks `lib/api/documents` — the module the component really
 * imports — because the test setup fails a request that escapes a mock
 * (forgejo#110), and a section that fetches on mount would otherwise assert
 * against the empty list a failed request leaves behind.
 */
const documentsApiMock = vi.hoisted(() => ({
  listForEntry: vi.fn(),
  limits: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
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

const FLIGHT = { type: "flight", id: "f1" } as const;

describe("DocumentsSection", () => {
  beforeEach(() => {
    isDemoMock.current = false;
    documentsApiMock.listForEntry.mockReset().mockResolvedValue([]);
    documentsApiMock.limits.mockReset().mockResolvedValue(LIMITS);
    documentsApiMock.upload.mockReset().mockResolvedValue(makeDocument());
    documentsApiMock.remove.mockReset().mockResolvedValue(undefined);
  });

  it("lists the entry's documents with name, size and date", async () => {
    documentsApiMock.listForEntry.mockResolvedValue([makeDocument()]);
    render(<DocumentsSection entry={FLIGHT} />);

    const link = await screen.findByRole("link", { name: "documents:openLabel" });
    expect(link).toHaveAttribute("href", "/api/v1/documents/d1/file");
    expect(screen.getByText(/24\.4 KB/)).toBeInTheDocument();
    expect(screen.getByText(/documents:kind\.boardingPass/)).toBeInTheDocument();
    expect(documentsApiMock.listForEntry).toHaveBeenCalledWith({ type: "flight", id: "f1" });
  });

  it("says there are none yet, rather than drawing an empty list", async () => {
    render(<DocumentsSection entry={FLIGHT} />);
    expect(await screen.findByText("documents:empty")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the size limits the server reports", async () => {
    render(<DocumentsSection entry={FLIGHT} />);
    expect(await screen.findByText("documents:limitHint")).toBeInTheDocument();
  });

  it("uploads the picked file for THIS entry and re-reads the list", async () => {
    render(<DocumentsSection entry={{ type: "lodgingStay", id: "s1" }} />);
    await screen.findByText("documents:empty");
    documentsApiMock.listForEntry.mockResolvedValue([makeDocument({ displayName: "bill.pdf" })]);

    const file = new File(["x"], "bill.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("documents-file-input"), { target: { files: [file] } });

    await waitFor(() =>
      expect(documentsApiMock.upload).toHaveBeenCalledWith({
        entry: { type: "lodgingStay", id: "s1" },
        file,
      })
    );
    // The list is re-read rather than appended to: a repeat of the same bytes
    // answers with the document already on file.
    await waitFor(() => expect(documentsApiMock.listForEntry).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("bill.pdf")).toBeInTheDocument();
  });

  it("refuses a file larger than its format's limit without spending the upload", async () => {
    render(<DocumentsSection entry={FLIGHT} />);
    await screen.findByText("documents:limitHint");

    const huge = new File(["x"], "scan.eml", { type: "message/rfc822" });
    Object.defineProperty(huge, "size", { value: 3 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId("documents-file-input"), { target: { files: [huge] } });

    expect(await screen.findByText("documents:tooLarge")).toBeInTheDocument();
    expect(documentsApiMock.upload).not.toHaveBeenCalled();
  });

  it("asks before it deletes, and only then calls the API", async () => {
    documentsApiMock.listForEntry.mockResolvedValue([makeDocument()]);
    render(<DocumentsSection entry={FLIGHT} />);

    fireEvent.click(await screen.findByRole("button", { name: "documents:removeLabel" }));
    expect(await screen.findByText("documents:deleteMessage")).toBeInTheDocument();
    expect(documentsApiMock.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "common:buttons.delete" }));
    await waitFor(() => expect(documentsApiMock.remove).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(screen.queryByText("LH2462.pdf")).toBeNull());
  });

  it("explains the shared demo instead of offering an upload that always fails", async () => {
    isDemoMock.current = true;
    documentsApiMock.listForEntry.mockResolvedValue([makeDocument()]);
    render(<DocumentsSection entry={FLIGHT} />);

    expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
    expect(screen.queryByTestId("documents-file-input")).toBeNull();
    // Nor a remove button: the same guard refuses the delete.
    expect(screen.queryByRole("button", { name: "documents:removeLabel" })).toBeNull();
    // And it does not ask for limits it may never use.
    expect(documentsApiMock.limits).not.toHaveBeenCalled();
  });

  it("turns a 403 DEMO_ACCOUNT_FORBIDDEN into the sentence, never the code", async () => {
    documentsApiMock.upload.mockRejectedValue({
      response: { status: 403, data: { error: "DEMO_ACCOUNT_FORBIDDEN" } },
    });
    render(<DocumentsSection entry={FLIGHT} />);
    await screen.findByText("documents:empty");

    const file = new File(["x"], "bill.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("documents-file-input"), { target: { files: [file] } });

    expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
    expect(screen.queryByText(/DEMO_ACCOUNT_FORBIDDEN/)).toBeNull();
    expect(screen.queryByText("documents:uploadFailed")).toBeNull();
  });

  it("says the list could not be loaded instead of claiming there is nothing", async () => {
    documentsApiMock.listForEntry.mockRejectedValue(new Error("offline"));
    render(<DocumentsSection entry={FLIGHT} />);

    expect(await screen.findByText("documents:loadFailed")).toBeInTheDocument();
    expect(screen.queryByText("documents:empty")).toBeNull();
    // ... and draws no empty list under the error either. An empty <ul> below
    // a failure reads as "the server answered, there is nothing", which is the
    // one thing the error line exists to deny.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("closes the dialog when the delete fails, and keeps the row it did not remove", async () => {
    documentsApiMock.listForEntry.mockResolvedValue([makeDocument()]);
    documentsApiMock.remove.mockRejectedValue(new Error("boom"));
    render(<DocumentsSection entry={FLIGHT} />);

    fireEvent.click(await screen.findByRole("button", { name: "documents:removeLabel" }));
    fireEvent.click(await screen.findByRole("button", { name: "common:buttons.delete" }));

    expect(await screen.findByText("documents:deleteFailed")).toBeInTheDocument();
    // The dialog used to stay open over the message, so the failure was
    // readable only behind a modal that looked like it was still working.
    await waitFor(() => expect(screen.queryByText("documents:deleteMessage")).toBeNull());
    expect(screen.getByText("LH2462.pdf")).toBeInTheDocument();
  });

  it("clears a stale message once something works", async () => {
    documentsApiMock.listForEntry.mockResolvedValue([makeDocument()]);
    render(<DocumentsSection entry={FLIGHT} />);
    await screen.findByText("documents:limitHint");

    const huge = new File(["x"], "scan.eml", { type: "message/rfc822" });
    Object.defineProperty(huge, "size", { value: 3 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId("documents-file-input"), { target: { files: [huge] } });
    expect(await screen.findByText("documents:tooLarge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "documents:removeLabel" }));
    fireEvent.click(await screen.findByRole("button", { name: "common:buttons.delete" }));

    await waitFor(() => expect(screen.queryByText("LH2462.pdf")).toBeNull());
    expect(screen.queryByText("documents:tooLarge")).toBeNull();
  });
});

/**
 * The inline form, which a place detail page draws once per VISIT.
 *
 * Eager, it cost one list request and one empty sentence per visit: a place
 * with six visits asked six times and printed "Noch keine Dokumente an diesem
 * Eintrag." six times under six headings. It opens on demand instead — and
 * carries no count, because a count is the very request being deferred.
 */
describe("DocumentsSection — the inline form on a visit row", () => {
  beforeEach(() => {
    isDemoMock.current = false;
    documentsApiMock.listForEntry.mockReset().mockResolvedValue([]);
    documentsApiMock.limits.mockReset().mockResolvedValue(LIMITS);
    documentsApiMock.upload.mockReset();
    documentsApiMock.remove.mockReset();
  });

  it("asks for nothing until a visit's documents are actually opened", async () => {
    for (const id of ["visit-1", "visit-2", "visit-3"]) {
      render(<DocumentsSection entry={{ type: "placeVisit", id }} layout="inline" />);
    }
    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3));
    expect(documentsApiMock.listForEntry).not.toHaveBeenCalled();
    expect(documentsApiMock.limits).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button")[1]);

    await waitFor(() => expect(documentsApiMock.listForEntry).toHaveBeenCalledTimes(1));
    expect(documentsApiMock.listForEntry).toHaveBeenCalledWith({
      type: "placeVisit",
      id: "visit-2",
    });
  });

  it("leaves the size limits to the full form — a row has no space for them", async () => {
    render(<DocumentsSection entry={{ type: "placeVisit", id: "visit-1" }} layout="inline" />);
    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("documents:empty")).toBeInTheDocument();
    expect(screen.getByTestId("documents-file-input")).toBeInTheDocument();
    expect(screen.queryByText("documents:limitHint")).toBeNull();
  });

  it("opens straight away in the card form, which stands alone on a page", async () => {
    render(<DocumentsSection entry={FLIGHT} />);
    await waitFor(() => expect(documentsApiMock.listForEntry).toHaveBeenCalledTimes(1));
  });
});

/**
 * `issuedOn` is a DATE, not an instant — the day printed on the bill. Read as
 * an instant it is UTC midnight, and every viewer west of Greenwich is shown
 * the day before. Same rule and same fix as `Stats/RecordsSection.tsx`.
 */
describe("DocumentsSection — the day written on the document", () => {
  let originalTz: string | undefined;

  beforeAll(() => {
    originalTz = process.env.TZ;
    // A UTC-NEGATIVE zone is what makes the defect observable at all, and it
    // must not depend on the zone the machine running this happens to be in.
    process.env.TZ = "America/Los_Angeles";
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  beforeEach(() => {
    isDemoMock.current = false;
    documentsApiMock.listForEntry.mockReset().mockResolvedValue([]);
    documentsApiMock.limits.mockReset().mockResolvedValue(LIMITS);
    documentsApiMock.upload.mockReset();
    documentsApiMock.remove.mockReset();
  });

  it("prints the issue date itself, not the day before it", async () => {
    documentsApiMock.listForEntry.mockResolvedValue([makeDocument({ issuedOn: "2026-09-18" })]);
    render(<DocumentsSection entry={FLIGHT} />);

    expect(await screen.findByText(/18\.09\.2026/)).toBeInTheDocument();
    expect(screen.queryByText(/17\.09\.2026/)).toBeNull();
  });

  it("still reads an undated document's createdAt as the instant it is", async () => {
    // Not a date-only string: a timestamp belongs in the viewer's own zone.
    documentsApiMock.listForEntry.mockResolvedValue([
      makeDocument({ issuedOn: null, createdAt: "2026-09-18T20:00:00.000Z" }),
    ]);
    render(<DocumentsSection entry={FLIGHT} />);

    expect(await screen.findByText(/18\.09\.2026/)).toBeInTheDocument();
  });
});
