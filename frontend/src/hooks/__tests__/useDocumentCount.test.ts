/**
 * The count behind findings 3 and 6 of the write-path audit (2026-09-19):
 * `Document` cascades from all five entry types — measured live against the
 * database by `backend/src/__tests__/integrity/cascades.integrity.test.ts` —
 * and no delete dialog named it. This hook is what lets them.
 *
 * Two properties are worth more than the count itself: it costs NOTHING until
 * a dialog is opening, and it never makes anyone wait.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useDocumentCount } from "../useDocumentCount";
import { documentsApi, type DocumentEntryRef, type TravelDocument } from "../../lib/api/documents";

vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn() },
}));

const listForEntry = vi.mocked(documentsApi.listForEntry);

const rows = (count: number): TravelDocument[] =>
  Array.from({ length: count }, (_, i) => ({ id: `d${i}` }) as TravelDocument);

const FLIGHT: DocumentEntryRef = { type: "flight", id: "f1" };

describe("useDocumentCount", () => {
  beforeEach(() => {
    listForEntry.mockReset();
  });

  it("asks for nothing while the dialog is closed", () => {
    listForEntry.mockResolvedValue(rows(3));

    const { result } = renderHook(() => useDocumentCount(null));

    expect(listForEntry).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("asks once the entry arrives — the moment the dialog is opening", async () => {
    listForEntry.mockResolvedValue(rows(2));

    const { result, rerender } = renderHook(
      ({ entry }: { entry: DocumentEntryRef | null }) => useDocumentCount(entry),
      { initialProps: { entry: null as DocumentEntryRef | null } }
    );

    rerender({ entry: FLIGHT });

    await waitFor(() => expect(result.current).toBe(2));
    expect(listForEntry).toHaveBeenCalledWith(FLIGHT);
  });

  it("is null while the answer is still on its way, so the dialog never waits", async () => {
    let settle: (documents: TravelDocument[]) => void = () => {};
    listForEntry.mockReturnValue(
      new Promise<TravelDocument[]>((resolve) => {
        settle = resolve;
      })
    );

    const { result } = renderHook(() => useDocumentCount(FLIGHT));

    expect(result.current).toBeNull();

    settle(rows(1));
    await waitFor(() => expect(result.current).toBe(1));
  });

  it("stays null when the request fails — unknown is not none", async () => {
    listForEntry.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useDocumentCount(FLIGHT));

    await waitFor(() => expect(listForEntry).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("drops the previous answer when the entry changes", async () => {
    listForEntry.mockResolvedValue(rows(4));

    const { result, rerender } = renderHook(
      ({ entry }: { entry: DocumentEntryRef | null }) => useDocumentCount(entry),
      { initialProps: { entry: FLIGHT as DocumentEntryRef | null } }
    );

    await waitFor(() => expect(result.current).toBe(4));

    // The stay dialog is ONE component reused for every stay. Carrying the
    // last stay's count into the next stay's question would be a wrong number
    // presented as a fact.
    listForEntry.mockResolvedValue(rows(0));
    rerender({ entry: { type: "lodgingStay", id: "s2" } });

    await waitFor(() => expect(result.current).toBe(0));
  });

  it("does not re-ask when the caller rebuilds an equal entry object", async () => {
    listForEntry.mockResolvedValue(rows(1));

    const { rerender } = renderHook(
      ({ entry }: { entry: DocumentEntryRef | null }) => useDocumentCount(entry),
      { initialProps: { entry: { type: "flight", id: "f1" } as DocumentEntryRef | null } }
    );

    await waitFor(() => expect(listForEntry).toHaveBeenCalledTimes(1));

    // Callers write the ref inline, so this is what every re-render looks like.
    rerender({ entry: { type: "flight", id: "f1" } });
    rerender({ entry: { type: "flight", id: "f1" } });

    expect(listForEntry).toHaveBeenCalledTimes(1);
  });
});
