import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DocumentLinkSuggestionsSection from "../DocumentLinkSuggestionsSection";
import { documentLinkSuggestionsApi } from "../../../lib/api/documentLinkSuggestions";
import { getJob } from "../../../lib/api/jobs";

/**
 * Plan D4: "Dieses Dokument belegt auch …". The user ticks entries and
 * confirms; a failure is said in place, never an empty block.
 */
vi.mock("../../../lib/api/documentLinkSuggestions", () => ({
  documentLinkSuggestionsApi: { list: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../../lib/api/jobs", () => ({ getJob: vi.fn() }));

const list = (over: object = {}) => ({
  suggestions: [
    {
      documentId: "doc-1",
      displayName: "buchung.pdf",
      kind: "booking",
      hidden: 0,
      entries: [
        {
          suggestionId: "s-1",
          entry: { type: "flight", id: "f-1" },
          label: "TP 572 · 2026-06-08",
          reason: "flightNumber" as const,
        },
        {
          suggestionId: "s-2",
          entry: { type: "lodgingStay", id: "l-1" },
          label: "Hotel Avenida",
          reason: "hotelDates" as const,
        },
      ],
    },
  ],
  total: 1,
  pass: { jobId: null },
  ...over,
});

describe("DocumentLinkSuggestionsSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders nothing when there is nothing to decide", async () => {
    vi.mocked(documentLinkSuggestionsApi.list).mockResolvedValue(
      list({ suggestions: [], total: 0 })
    );
    const { container } = render(<DocumentLinkSuggestionsSection />);
    await waitFor(() => expect(documentLinkSuggestionsApi.list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("sends only the ticked entries when the user confirms", async () => {
    vi.mocked(documentLinkSuggestionsApi.list).mockResolvedValue(list());
    vi.mocked(documentLinkSuggestionsApi.accept).mockResolvedValue({ linked: 1, skipped: 0 });
    render(<DocumentLinkSuggestionsSection />);
    expect(await screen.findByText("TP 572 · 2026-06-08")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    await userEvent.click(boxes[1]);
    await userEvent.click(screen.getByRole("button", { name: /\.accept$/ }));
    await waitFor(() =>
      expect(documentLinkSuggestionsApi.accept).toHaveBeenCalledWith("doc-1", ["s-1"])
    );
  });

  it("dismisses only the entries that were shown, never the ones hidden behind the cap", async () => {
    const base = list();
    vi.mocked(documentLinkSuggestionsApi.list).mockResolvedValue({
      ...base,
      suggestions: [{ ...base.suggestions[0], hidden: 5 }],
    });
    vi.mocked(documentLinkSuggestionsApi.dismiss).mockResolvedValue(undefined);
    render(<DocumentLinkSuggestionsSection />);
    expect(await screen.findByRole("note")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /\.dismiss$/ }));
    await waitFor(() =>
      expect(documentLinkSuggestionsApi.dismiss).toHaveBeenCalledWith("doc-1", ["s-1", "s-2"])
    );
  });

  it("says so in place when the answer could not be saved", async () => {
    vi.mocked(documentLinkSuggestionsApi.list).mockResolvedValue(list());
    vi.mocked(documentLinkSuggestionsApi.dismiss).mockRejectedValue(new Error("boom"));
    render(<DocumentLinkSuggestionsSection />);
    await screen.findByText("Hotel Avenida");
    await userEvent.click(screen.getByRole("button", { name: /\.dismiss$/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows how far the scan of stored documents has got", async () => {
    vi.mocked(documentLinkSuggestionsApi.list).mockResolvedValue(
      list({ suggestions: [], total: 0, pass: { jobId: "job-1" } })
    );
    vi.mocked(getJob).mockResolvedValue({
      id: "job-1",
      kind: "documentLinks.pass",
      status: "running",
      startedAt: "",
      finishedAt: null,
      result: null,
      error: null,
      progress: { done: 3, total: 9 },
    });
    render(<DocumentLinkSuggestionsSection />);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(getJob).toHaveBeenCalledWith("job-1");
  });
});
