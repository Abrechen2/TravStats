import type { JSX, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { useEvidence } from "../useEvidence";
import { evidenceApi } from "../../../lib/api/evidence";
import type { EvidenceResponse } from "../../../shared/evidence";

vi.mock("../../../lib/api/evidence", () => ({
  evidenceApi: { get: vi.fn() },
}));

function response(overrides: Partial<EvidenceResponse> = {}): EvidenceResponse {
  return {
    measure: {
      kind: "metric",
      key: "flightCount",
      aggregation: "sum",
      label: { key: "evidence.metric.flightCount" },
      unit: "flights",
      value: 2,
      scope: { period: { kind: "allTime" } },
    },
    entries: [],
    returned: 0,
    omitted: { count: 0 },
    unattributed: [],
    page: { offset: 0, limit: 100 },
    ...overrides,
  };
}

/** Reads the current `evidence` param — the assertion surface for "the URL owns it". */
function useCurrentParams() {
  const [params] = useSearchParams();
  return params;
}

function wrapper(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };
}

describe("useEvidence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stays closed and fetches nothing without an `evidence` param", () => {
    const { result } = renderHook(() => useEvidence(), { wrapper: wrapper(["/stats"]) });
    expect(result.current.isOpen).toBe(false);
    expect(evidenceApi.get).not.toHaveBeenCalled();
  });

  it("open() writes ?evidence=<kind>:<key> and KEEPS other params", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    const { result } = renderHook(() => ({ evidence: useEvidence(), params: useCurrentParams() }), {
      wrapper: wrapper(["/stats?tab=all"]),
    });

    act(() => result.current.evidence.open("metric", "flightCount"));

    await waitFor(() => expect(result.current.evidence.isOpen).toBe(true));
    expect(result.current.params.get("tab")).toBe("all");
    expect(result.current.params.get("evidence")).toBe("metric:flightCount");
    expect(evidenceApi.get).toHaveBeenCalledWith(
      "metric",
      "flightCount",
      expect.objectContaining({ offset: 0 })
    );
  });

  it("close() removes ONLY ?evidence, leaving sibling params alone", async () => {
    const { result } = renderHook(() => ({ evidence: useEvidence(), params: useCurrentParams() }), {
      wrapper: wrapper(["/stats?tab=all&evidence=metric%3AflightCount"]),
    });
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    await waitFor(() => expect(result.current.evidence.isOpen).toBe(true));

    act(() => result.current.evidence.close());

    expect(result.current.evidence.isOpen).toBe(false);
    expect(result.current.params.get("evidence")).toBeNull();
    expect(result.current.params.get("tab")).toBe("all");
  });

  it("splits kind:key on the FIRST colon — a ranking key keeps its own colon", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValue(response());
    const { result } = renderHook(() => useEvidence(), {
      wrapper: wrapper(["/stats?evidence=ranking%3Aairline%3ALH"]),
    });
    await waitFor(() => expect(result.current.kind).toBe("ranking"));
    expect(result.current.key).toBe("airline:LH");
  });

  it("loadMore() APPENDS the second page rather than replacing the first", async () => {
    vi.mocked(evidenceApi.get).mockResolvedValueOnce(
      response({
        entries: [
          {
            domain: "flight",
            id: "f1",
            href: "/flights/f1",
            title: { text: "LH1" },
            subtitle: null,
            date: null,
            contribution: 1,
          },
        ],
        returned: 1,
        omitted: { count: 1 },
      })
    );
    const { result } = renderHook(() => useEvidence(), {
      wrapper: wrapper(["/stats?evidence=metric%3AflightCount"]),
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);

    vi.mocked(evidenceApi.get).mockResolvedValueOnce(
      response({
        entries: [
          {
            domain: "flight",
            id: "f2",
            href: "/flights/f2",
            title: { text: "LH2" },
            subtitle: null,
            date: null,
            contribution: 1,
          },
        ],
        returned: 1,
        // Page two of a two-row measure: the row page one showed is still
        // "known and not on this page", so a resolver reports 1 here, never
        // 0 (`rankingEvidence.ts`'s own reading of `omitted`).
        omitted: { count: 1 },
        page: { offset: 1, limit: 100 },
      })
    );
    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.entries.map((e) => e.id)).toEqual(["f1", "f2"]);
    expect(result.current.hasMore).toBe(false);
    expect(evidenceApi.get).toHaveBeenLastCalledWith(
      "metric",
      "flightCount",
      expect.objectContaining({ offset: 1 })
    );
  });

  /**
   * `hasMore` used to be `omitted.count > 0`, which never went false: at 250
   * rows and a 100 limit, page three still reported 200 omitted (every known
   * row not on THAT page), so the button stayed and the next click fetched
   * offset 250 and appended nothing, forever. What bounds the list is the
   * accumulated `entries.length` against the whole known population,
   * `returned + omitted.count`.
   */
  it("stops asking for more once the accumulated rows cover the whole known population", async () => {
    const row = (n: number) => ({
      domain: "flight" as const,
      id: `f${n}`,
      href: `/flights/f${n}`,
      title: { text: `LH${n}` },
      subtitle: null,
      date: null,
      contribution: 1,
    });
    const pageOf = (offset: number, size: number) =>
      response({
        entries: Array.from({ length: size }, (_, i) => row(offset + i)),
        returned: size,
        omitted: { count: 250 - size, contribution: 250 - size },
        page: { offset, limit: 100 },
      });

    vi.mocked(evidenceApi.get)
      .mockResolvedValueOnce(pageOf(0, 100))
      .mockResolvedValueOnce(pageOf(100, 100))
      .mockResolvedValueOnce(pageOf(200, 50));

    const { result } = renderHook(() => useEvidence(), {
      wrapper: wrapper(["/stats?evidence=metric%3AflightCount"]),
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(100));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(200));
    // 200 of 250 in hand — `omitted.count` still says 150 on this page.
    expect(result.current.response?.omitted.count).toBe(150);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(250));
    expect(result.current.hasMore).toBe(false);
  });
});
