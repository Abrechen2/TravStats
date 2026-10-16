// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  probeStyle,
  rasterFallbackFor,
  resetStyleHealth,
  resilientStyle,
  useResilientStyle,
} from "./basemapFallback";
import { resolveFlatStyle } from "./basemapStyles";
import { useToastStore } from "../../store/toastStore";
import { useBasemapStyle } from "./useBasemapStyle";

const style = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => {
  resetStyleHealth();
  useToastStore.getState().clearToasts();
});
afterEach(() => {
  delete window.__TRAVSTATS_GEO__;
});

// OpenFreeMap was a single point of failure: when its style did not load,
// every vector map stayed blank and nothing said why.
describe("basemap fallback", () => {
  it("keeps the vector style when it loads", async () => {
    await probeStyle(resolveFlatStyle("dark") as string, style({ version: 8 }));
    expect(resilientStyle("dark")).toBe(resolveFlatStyle("dark"));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
  it.each([
    ["an unreachable provider", vi.fn(async () => Promise.reject(new TypeError("offline")))],
    ["a server error", style({}, 503)],
    ["a document that is no style", style({ error: "x" })],
  ])("switches to the raster fallback once after %s, and says so", async (_label, fetcher) => {
    const url = resolveFlatStyle("light") as string;
    await probeStyle(url, fetcher as unknown as typeof fetch);
    await probeStyle(url, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resilientStyle("light")).toBe(rasterFallbackFor("light"));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("warning");
  });
  it("gives every vector style its own key-free raster fallback", () => {
    for (const id of ["standard", "light", "dark", "voyager"] as const) {
      const fallback = rasterFallbackFor(id);
      expect(fallback?.sources.base).toMatchObject({ type: "raster" });
      expect(JSON.stringify(fallback)).not.toContain("openfreemap");
    }
    expect(rasterFallbackFor("satellite")).toBeNull();
  });
  it("tells but never falls back to a third party on an own map server", async () => {
    window.__TRAVSTATS_GEO__ = { mode: "own" };
    const url = resolveFlatStyle("dark") as string;
    await probeStyle(url, style({}, 404));
    expect(resilientStyle("dark")).toBe(url);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
  it("re-renders a map that already shows the failed style", async () => {
    const { result } = renderHook(() => useResilientStyle("dark"));
    expect(result.current).toBe(resolveFlatStyle("dark"));
    await act(() => probeStyle(resolveFlatStyle("dark") as string, style({}, 500)));
    expect(result.current).toBe(rasterFallbackFor("dark"));
  });
  it("reaches every detail map through the shared basemap hook", async () => {
    localStorage.clear();
    const { result } = renderHook(useBasemapStyle);
    await act(() => probeStyle(resolveFlatStyle("dark") as string, style({}, 502)));
    expect(result.current).toBe(rasterFallbackFor("dark"));
  });
});
