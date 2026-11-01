import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useEntrySuggestions } from "../useEntrySuggestions";

describe("useEntrySuggestions (forgejo#405)", () => {
  it("reports a failed request as failed, with the empty vocabulary — not as nothing found", async () => {
    const load = vi.fn().mockRejectedValue({ status: 503 });
    const { result } = renderHook(() => useEntrySuggestions(load, {}, { chips: [] as string[] }));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.suggestions).toEqual({ chips: [] });
  });

  it("sends only the typed values, once they have settled", async () => {
    const load = vi.fn().mockResolvedValue({ chips: ["Sixt"] });
    const { result } = renderHook(() =>
      useEntrySuggestions(load, { provider: "  ", broker: "Check24" }, { chips: [] as string[] })
    );
    await waitFor(() => expect(result.current.suggestions.chips).toEqual(["Sixt"]));
    expect(load).toHaveBeenCalledWith({ broker: "Check24" });
    expect(result.current.failed).toBe(false);
  });
});
