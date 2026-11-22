import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api", () => ({ tripsApi: {} }));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: <T,>(select: (s: unknown) => T): T => select({ addToast: vi.fn() }),
}));

vi.mock("../../../hooks/useTripEntrySuggestions", () => ({ useTripEntrySuggestions: () => [] }));

import { useTripModalForm } from "../tripModalForm";

/** A new trip from the gap calendar opens with the gap's first and last day. */
describe("useTripModalForm — a gap's days", () => {
  it("starts a new trip on the gap's days", () => {
    const { result } = renderHook(() =>
      useTripModalForm(null, vi.fn(), { from: "2024-03-04", to: "2024-03-07" })
    );
    expect(result.current.startDate).toBe("2024-03-04");
    expect(result.current.endDate).toBe("2024-03-07");
  });

  it("without a gap a new trip has no dates", () => {
    const { result } = renderHook(() => useTripModalForm(null, vi.fn()));
    expect(result.current.startDate).toBe("");
    expect(result.current.endDate).toBe("");
  });
});
