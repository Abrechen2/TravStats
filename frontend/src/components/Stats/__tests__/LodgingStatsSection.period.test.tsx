import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
// Every figure in the comparison strip is an `EvidenceTrigger` since
// 2026-09-19, and a trigger reads the URL - so the section needs a router
// even in the cases below, which stop at the empty-year branch.
import { MemoryRouter, useLocation } from "react-router-dom";
import { EVIDENCE_MEASURES } from "../../../shared/evidenceMeasures";
import type { LodgingStats } from "../../../types/lodging";

/** `MemoryRouter` never touches `window.location`, so the search string has to be read from inside it. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

const getLodgingStats = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/lodging", () => ({ getLodgingStats }));

import LodgingStatsSection from "../LodgingStatsSection";
import { ALL_VISIBLE, hiding } from "./sectionVisibilityStub";

/**
 * Owner review 2026-09-15: the overview said "no stays in 2026" while this tab
 * showed four. The server learned `?year=` (23b2736e); this pins that the tab
 * asks for it, compares with a second request, and says which year was empty.
 *
 * Every case keeps the stays at zero, so the section stops before the eight
 * blocks that each want a fully populated rollup. What is pinned is the
 * question asked, not the arithmetic, which has its own tests.
 */
const empty = (over: Partial<LodgingStats> = {}): LodgingStats =>
  ({ lodgingsCount: 0, staysCount: 0, totalNights: 0, countriesCount: 0, ...over }) as LodgingStats;

describe("LodgingStatsSection under the page's period", () => {
  beforeEach(() => {
    getLodgingStats.mockReset();
  });

  it("asks the server for the chosen year", async () => {
    getLodgingStats.mockResolvedValue(empty());
    render(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: 2026, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    await screen.findByText("stats:period.emptyYear");
    expect(getLodgingStats).toHaveBeenCalledTimes(1);
    expect(getLodgingStats).toHaveBeenCalledWith({ year: 2026 });
  });

  it("asks for the lifetime view when no year is chosen", async () => {
    getLodgingStats.mockResolvedValue(empty());
    render(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: null, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    await screen.findByText("lodging:list.empty");
    expect(getLodgingStats).toHaveBeenCalledWith(undefined);
  });

  it("names the year when it had no stay, even though houses exist", async () => {
    // Four houses in the lifetime view, none slept in this year: "no stays yet"
    // would be false, and going by the house count would draw an empty tab.
    getLodgingStats.mockResolvedValue(empty({ lodgingsCount: 4 }));
    render(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: 2026, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect(await screen.findByText("stats:period.emptyYear")).toBeInTheDocument();
    expect(screen.queryByText("lodging:list.empty")).not.toBeInTheDocument();
  });

  it("compares with a second request, and still compares for an empty year", async () => {
    getLodgingStats.mockImplementation(async (params?: { year?: number }) =>
      params?.year === 2025 ? empty({ staysCount: 3, totalNights: 9 }) : empty()
    );
    render(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: 2026, compareYear: 2025 }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    // Either key: the strip says "vs 2025" for a year that is over and
    // "vs. the whole of 2025" while 2026 is still running (see
    // `lib/stats/comparisonWindow.ts`). What this test is about is that it
    // compares at all, so it must not pin the wall clock.
    expect(await screen.findByText(/^stats:yearFilter\.vs/)).toBeInTheDocument();
    expect(getLodgingStats).toHaveBeenCalledWith({ year: 2025 });
    expect(screen.getByText("stats:period.emptyYear")).toBeInTheDocument();
  });
});

// Measured on the beta, 2026-09-16: switching from 2026 to 2015 relabelled the
// strip "Year 2015" at once while the tiles still showed 2026 — for exactly as
// long as the request took. A label must name the year its figures belong to.
describe("LodgingStatsSection while the next year loads", () => {
  it("keeps naming the year its figures belong to, marked busy, until the new ones land", async () => {
    let resolve2024: (value: LodgingStats) => void = () => {};
    getLodgingStats.mockImplementation((params?: { year?: number }) => {
      if (params?.year === 2024) {
        return new Promise<LodgingStats>((r) => {
          resolve2024 = r;
        });
      }
      return Promise.resolve(empty());
    });

    const { rerender, container } = render(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: 2026, compareYear: 2025 }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    // The strip prints the compare year raw beside each previous figure.
    expect((await screen.findAllByText(/\(2025\)/)).length).toBeGreaterThan(0);
    expect(container.querySelector("[aria-busy='true']")).toBeNull();

    rerender(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: 2026, compareYear: 2024 }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    // 2025's figures are still on screen, so the strip must still say 2025.
    expect(screen.queryAllByText(/\(2024\)/)).toHaveLength(0);
    expect(screen.getAllByText(/\(2025\)/).length).toBeGreaterThan(0);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();

    resolve2024(empty({ totalNights: 4 }));
    await waitFor(() => expect(screen.getAllByText(/\(2024\)/).length).toBeGreaterThan(0));
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });
});

/**
 * Whenever the comparison strip is drawn, `LodgingStatStrip` below it is told
 * to `omit` stays, nights and houses — so these four cells are the ONLY place
 * those figures appear in the year-over-year view. Three of them carried no
 * trigger until 2026-09-19, behind a comment claiming the strip below still
 * had them; this is what makes that claim measurable rather than prose.
 */
describe("the comparison strip's own figures", () => {
  beforeEach(() => {
    getLodgingStats.mockReset();
  });

  /**
   * Every block below the strip is hidden, so the only buttons on screen are
   * the four cells under test. It also keeps the fixture honest: the eight
   * sections each want a fully populated rollup, and padding one out to make
   * them render would measure the padding rather than the strip.
   */
  const STRIP_ONLY = hiding("kpis", "money", "quality", "geo", "rhythm", "loyalty", "records");

  it("opens a different served measure from each of its four cells", async () => {
    // Non-zero stays, or the section returns the empty-year branch before it
    // reaches the strip.
    getLodgingStats.mockImplementation((params?: { year?: number }) =>
      Promise.resolve(
        empty({
          staysCount: params?.year === 2025 ? 3 : 9,
          totalNights: 21,
          lodgingsCount: 5,
          countriesCount: 3,
        })
      )
    );
    let search = "";
    render(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: 2026, compareYear: 2025 }} visibility={STRIP_ONLY} />
        <LocationProbe
          onChange={(next) => {
            search = next;
          }}
        />
      </MemoryRouter>
    );
    await screen.findByText("dashboard:lodgingTab.stats.stays");

    const keys: string[] = [];
    for (const cell of ["stays", "nights", "hotels"]) {
      const trigger = screen.getByRole("button", { name: `dashboard:lodgingTab.stats.${cell}` });
      await act(async () => {
        trigger.click();
      });
      keys.push(new URLSearchParams(search).get("evidence") ?? "");
    }
    await act(async () => {
      screen.getByRole("button", { name: "stats:sections.countries" }).click();
    });
    keys.push(new URLSearchParams(search).get("evidence") ?? "");

    expect(keys).toEqual([
      "metric:lodgingStaysCount",
      "metric:lodgingNightsTotal",
      "metric:lodgingsUniqueCount",
      "metric:lodgingCountriesCount",
    ]);
    // Every one is a registered measure release 1 actually serves — a key set
    // alone would not notice a plausible name nothing answers for.
    expect(
      keys.filter((raw) => EVIDENCE_MEASURES[raw.slice(raw.indexOf(":") + 1)]?.servedIn !== 1)
    ).toEqual([]);
  });

  it("sends the strip's own year as the scope, not the tab's lifetime default", async () => {
    getLodgingStats.mockResolvedValue(
      empty({ staysCount: 9, totalNights: 21, lodgingsCount: 5, countriesCount: 3 })
    );
    const { useEvidenceOpenStore } = await import("../../evidence/evidenceOpenStore");
    render(
      <MemoryRouter>
        <LodgingStatsSection scope={{ year: 2026, compareYear: 2025 }} visibility={STRIP_ONLY} />
      </MemoryRouter>
    );
    await screen.findByText("dashboard:lodgingTab.stats.nights");
    await act(async () => {
      screen.getByRole("button", { name: "dashboard:lodgingTab.stats.nights" }).click();
    });
    expect(useEvidenceOpenStore.getState().scope).toEqual({ period: "year", year: 2026 });
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(21);
  });
});
