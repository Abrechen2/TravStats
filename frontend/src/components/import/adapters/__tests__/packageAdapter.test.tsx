import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { parseApi } from "../../../../lib/api/parse";
import { PackageReviewSlot } from "../packageAdapter";
import { useTripImportAdapter } from "../tripAdapter";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});
vi.mock("../../../Trips/PackageImportPreviewModal", () => ({
  PackageImportPreviewModal: (props: { readByModel?: { dropped: unknown[] } }) => (
    <div data-testid="package-modal" data-by-model={props.readByModel ? "yes" : "no"} />
  ),
}));
vi.mock("../../../../lib/api/parse", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/parse")>()),
  parseApi: { readPackageWithModel: vi.fn() },
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

  describe("a kept PDF no template reads", () => {
    const kept = empty({ fallbackCode: "noTemplate", documentId: "d1" });
    const reading = {
      bookingReference: "X1",
      issuedOn: "2026-01-01",
      flights: [],
      stays: [],
    };

    it("offers the model instead of a dead end, and cancelling reads and saves nothing", () => {
      vi.mocked(parseApi.readPackageWithModel).mockClear();
      const onEmpty = vi.fn();
      const onCancel = vi.fn();
      const onCommit = vi.fn();
      render(
        <PackageReviewSlot
          parseResult={kept}
          onCommit={onCommit}
          onCancel={onCancel}
          onEmpty={onEmpty}
          onSaved={vi.fn()}
        />
      );
      expect(screen.getByText(/Mit KI lesen\?/)).toBeInTheDocument();
      expect(onEmpty).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      expect(onCancel).toHaveBeenCalled();
      expect(parseApi.readPackageWithModel).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("opens the review marked as model-read, with what the gate dropped", async () => {
      vi.mocked(parseApi.readPackageWithModel).mockResolvedValue({
        ...kept,
        package: reading,
        parserUsed: "ollama",
        modelDropped: [{ kind: "flight", value: "XX999" }],
      } as never);
      const { findByTestId } = render(
        <PackageReviewSlot
          parseResult={kept}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
          onEmpty={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Mit KI lesen" }));
      const modal = await findByTestId("package-modal");
      expect(modal).toHaveAttribute("data-by-model", "yes");
      expect(parseApi.readPackageWithModel).toHaveBeenCalledWith("d1");
    });

    it("shows the reason when the provider failed, and stays open for a retry", async () => {
      vi.mocked(parseApi.readPackageWithModel).mockResolvedValue({
        ...kept,
        fallbackCode: "modelFailed",
        fallbackReason: "The AI parser failed: Ollama request timed out after 180s",
      } as never);
      const onCancel = vi.fn();
      render(
        <PackageReviewSlot
          parseResult={kept}
          onCommit={vi.fn()}
          onCancel={onCancel}
          onEmpty={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Mit KI lesen" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/nicht geantwortet/);
      expect(alert).toHaveTextContent(/timed out after 180s/);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("says so when the request itself fails", async () => {
      vi.mocked(parseApi.readPackageWithModel).mockRejectedValue(new Error("network"));
      render(
        <PackageReviewSlot
          parseResult={kept}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
          onEmpty={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Mit KI lesen" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Anfrage ist fehlgeschlagen/);
    });
  });
});
