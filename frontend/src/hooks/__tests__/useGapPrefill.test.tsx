import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useGapPrefill } from "../useGapPrefill";

function at(url: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };
}

describe("useGapPrefill", () => {
  it("hands the page the gap's days once and strips them from the URL", async () => {
    const { result } = renderHook(() => ({ gap: useGapPrefill(), search: useLocation().search }), {
      wrapper: at("/rail?addFrom=2024-03-04&addTo=2024-03-07&keep=1"),
    });
    await waitFor(() => expect(result.current.gap.request).not.toBeNull());
    expect(result.current.gap.request?.dates).toEqual({ from: "2024-03-04", to: "2024-03-07" });
    await waitFor(() => expect(result.current.search).toBe("?keep=1"));
  });

  it("an unreal first day still asks the page to open its form, on its own defaults", async () => {
    const { result } = renderHook(() => useGapPrefill(), { wrapper: at("/rail?addFrom=nonsense") });
    await waitFor(() => expect(result.current.request).not.toBeNull());
    expect(result.current.request?.dates).toBeNull();
  });

  it("a page nobody sent a gap to is not asked to open anything", () => {
    const { result } = renderHook(() => useGapPrefill(), { wrapper: at("/rail") });
    expect(result.current.request).toBeNull();
  });
});
