import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useLodgingImportAdapter } from "../adapters/lodgingAdapter";

const previewLodgingImport = vi.fn();
vi.mock("../../../lib/api/lodgingImport", () => ({
  previewLodgingImport: (...args: unknown[]) => previewLodgingImport(...args),
  commitLodgingImport: vi.fn(async () => ({
    batchId: "b1",
    createdLodgings: 1,
    createdStays: 1,
    skipped: 0,
    failed: [],
  })),
  suggestLodgingCsvMapping: vi.fn(async () => ({})),
}));

describe("useLodgingImportAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewLodgingImport.mockResolvedValue({
      rows: [
        {
          sourceRowIndex: 0,
          lodging: { name: "Musterhotel" },
          stay: { checkIn: "2026-01-05", checkOut: "2026-01-07" },
          flags: [],
          dedupeHint: "none",
          matchedLodgingId: null,
          matchedStayId: null,
          action: "create",
        },
      ],
      summary: { newRows: 1, alreadyPresent: 0, needsInput: 0 },
    });
  });

  it("declares the lodging domain and accepts the e-mail formats the route supports", () => {
    const { result } = renderHook(() => useLodgingImportAdapter());
    expect(result.current.domain).toBe("lodging");
    expect(result.current.acceptedEmailExtensions).toEqual([".eml", ".msg", ".txt"]);
  });

  it("sends the parse result's candidates to /preview and renders the preview modal", async () => {
    const { result } = renderHook(() => useLodgingImportAdapter());

    render(
      <>
        {result.current.renderReviewModal({
          parseResult: {
            domain: "lodging",
            candidates: [
              {
                sourceRowIndex: 0,
                lodging: { name: "Musterhotel" },
                stay: { checkIn: "2026-01-05", checkOut: "2026-01-07" },
              },
            ],
            parserUsed: "template",
            ollamaAvailable: false,
          },
          onCommit: vi.fn(),
          onCancel: vi.fn(),
        })}
      </>
    );

    await waitFor(() => expect(previewLodgingImport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("lodging-import-counts")).toBeInTheDocument());
  });

  it("falls back to manual entry when the parser found nothing", async () => {
    const onCancel = vi.fn();
    const { result } = renderHook(() => useLodgingImportAdapter());

    render(
      <>
        {result.current.renderReviewModal({
          parseResult: {
            domain: "lodging",
            candidates: [],
            parserUsed: "none",
            ollamaAvailable: false,
            fallbackReason: "Ollama is not reachable",
          },
          onCommit: vi.fn(),
          onCancel,
        })}
      </>
    );

    // No preview, and the panel is released so the user can switch to manual.
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(previewLodgingImport).not.toHaveBeenCalled();
  });
});
