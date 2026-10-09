import { describe, expect, it, vi } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { PackageReviewSlot } from "../packageAdapter";
import { useTripImportAdapter } from "../tripAdapter";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});
vi.mock("../../../Trips/PackageImportPreviewModal", () => ({
  PackageImportPreviewModal: () => <div data-testid="package-modal" />,
}));

const empty = (extra: Record<string, unknown>) => ({
  domain: "package",
  package: null,
  template: null,
  parserUsed: "none",
  ollamaAvailable: false,
  pdfTextLength: 1200,
  ...extra,
});

describe("package review", () => {
  it("says no template knows the operator, instead of showing an empty trip", async () => {
    const onEmpty = vi.fn();
    const onCancel = vi.fn();
    const { queryByTestId } = render(
      <PackageReviewSlot
        parseResult={empty({ fallbackCode: "noTemplate" })}
        onCommit={vi.fn()}
        onCancel={onCancel}
        onEmpty={onEmpty}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() => expect(onEmpty).toHaveBeenCalledTimes(1));
    expect(onEmpty.mock.calls[0][0]).toMatch(/keine Veranstalter-Vorlage/);
    expect(onCancel).toHaveBeenCalled();
    expect(queryByTestId("package-modal")).toBeNull();
  });

  it("names the operator whose template read the document incompletely", async () => {
    const onEmpty = vi.fn();
    render(
      <PackageReviewSlot
        parseResult={empty({
          fallbackCode: "invalidReading",
          template: { id: "package:x", version: "1", issuer: "Berge & Meer" },
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onEmpty={onEmpty}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() => expect(onEmpty.mock.calls[0][0]).toMatch(/Berge & Meer/));
  });

  it("opens the proposal for a reading", () => {
    const { getByTestId } = render(
      <PackageReviewSlot
        parseResult={empty({
          package: { bookingReference: "X", issuedOn: "2026-01-01", flights: [], stays: [] },
          documentId: "d1",
        })}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onEmpty={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(getByTestId("package-modal")).toBeInTheDocument();
  });

  it("makes the trip import read documents as packages", () => {
    const { result } = renderHook(() => useTripImportAdapter(vi.fn()));
    expect(result.current.supportsDocumentImport).toBe(true);
    expect(result.current.parseAs).toBe("package");
  });
});
