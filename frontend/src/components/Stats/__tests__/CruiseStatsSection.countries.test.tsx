import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { EVIDENCE_MEASURES } from "../../../shared/evidenceMeasures";
import type { CruiseStatsResponse } from "../../../lib/api/stats";

/**
 * The port catalogue carries BOTH "United States" and "United States of
 * America", so counting raw names reported one country too many — and
 * disagreed with the cross-domain "countries visited" tile, which folds both
 * onto US. The tile counts the folded set; the tag cloud keeps the names.
 */
const api = vi.hoisted(() => ({ getCruiseStats: vi.fn() }));

vi.mock("../../../lib/api/stats", () => ({ statsApi: api }));

// The section reads the cruise ROWS as well as the rollup now — the calendar,
// the money and the firsts are not in the rollup and never were.
vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));

// ONE translation object, as the real hook hands out. The section's fetch
// effect depends on `t`, so a fresh function per render re-fetched on every
// state change — invisible until a test counted the requests.
const translation = vi.hoisted(() => ({ t: (k: string) => k, i18n: { language: "de" } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => translation,
}));

import CruiseStatsSection from "../CruiseStatsSection";
import { ALL_VISIBLE, hiding } from "./sectionVisibilityStub";

const LIFETIME = { year: null, compareYear: null };

const base = {
  cruisesCount: 2,
  cruisePortsUnique: 4,
  cruisePortsSingleMax: 3,
  cruiseShipsUnique: 2,
  cruiseLines: [],
  cruiseLinesUnique: 0,
  cruiseLineLoyaltyMax: 0,
  seaDays: 3,
  seaDaysStreak: 2,
  regions: [],
  regionVisitCounts: {},
  countries: ["Germany", "United States", "United States of America"],
  countriesIso: ["DE", "US"],
  totalDistanceKm: 100,
  longestLegKm: 50,
  totalPortCalls: 4,
  totalCruiseDays: 10,
  hasBalconyCabin: false,
  hasSuiteCabin: false,
  maxDeck: 0,
  hasCanalTransit: false,
  hasPolar: false,
  hasColdWater: false,
  hasDatelineCrossing: false,
  hasBirthdayAtSea: false,
  hasNewYearsAtSea: false,
} as unknown as CruiseStatsResponse;

/** `MemoryRouter` never touches `window.location`, so the search string has to be read from inside it. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

/**
 * Which tiles open the evidence panel, and under which key — read from the URL
 * the tile itself writes, because `?evidence=metric:<key>` is the whole
 * contract between a tile and the panel and a tile wired to the wrong key
 * looks identical to a correct one until it is clicked.
 *
 * Two served cruise measures are deliberately absent from THIS list.
 * `cruiseTotalSpend` does have a tile now — the base-currency total in
 * `CruiseMoneySection` — but that whole section renders only once a cruise
 * carries a price, and `cruiseApi.list()` answers with no rows here. Its own
 * suite (`cruise/__tests__/CruiseMoneySection.test.tsx`) covers it against
 * rows that do. `cruiseCompanionCount` is the total of a ranked list and has
 * no card of its own at all. Both are served and reachable by
 * `?evidence=metric:<key>`.
 */
describe("CruiseStatsSection evidence wiring", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  it("wires the eight tiles whose measures release 1 serves", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    let search = "";
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
        <LocationProbe
          onChange={(next) => {
            search = next;
          }}
        />
      </MemoryRouter>
    );
    await screen.findByText("stats:cruiseSection.countries");

    const keys: string[] = [];
    for (const trigger of screen.getAllByRole("button")) {
      await act(async () => {
        trigger.click();
      });
      const raw = new URLSearchParams(search).get("evidence") ?? "";
      keys.push(raw.slice(raw.indexOf(":") + 1));
    }
    expect(keys.sort()).toEqual(
      [
        "cruiseCount",
        "cruiseCountriesCount",
        "cruiseDistanceKmTotal",
        "cruiseLinesUniqueCount",
        "cruisePortsUniqueCount",
        "cruiseSeaDaysTotal",
        "cruiseShipsUniqueCount",
        "cruiseTotalDays",
      ].sort()
    );
    expect(keys.every((key) => EVIDENCE_MEASURES[key]?.servedIn === 1)).toBe(true);
    // The ratio, extremum and sequence tiles beside them stay plain: release 1
    // serves neither kind, and a trigger there is a pointer cursor on a 404.
    expect(keys).not.toContain("cruiseAvgPortsPerCruise");
    expect(keys).not.toContain("cruiseLongestLegKm");
  });
});

describe("CruiseStatsSection countries tile", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  it("counts the folded set, so a catalogue duplicate is not a second country", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    // 2 (DE, US) — not 3, which counting the raw names would give.
    const tile = await screen.findByText("stats:cruiseSection.countries");
    expect(tile.parentElement?.textContent).toContain("2");
  });

  it("still lists the full names in the tag cloud", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect(await screen.findByText("United States of America")).toBeInTheDocument();
  });

  it("falls back to the names when an older backend sends no folded list", async () => {
    api.getCruiseStats.mockResolvedValue({ ...base, countriesIso: undefined });
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    const tile = await screen.findByText("stats:cruiseSection.countries");
    expect(tile.parentElement?.textContent).toContain("3");
  });
});

// Owner review 2026-09-15: the overview said "no cruises in 2026" while this
// tab showed every cruise ever sailed. The tab now answers for the page's year.
describe("CruiseStatsSection under the page's period", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  it("asks the server for the chosen year, and for nothing else", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={{ year: 2024, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    await screen.findByText("stats:cruiseSection.countries");
    expect(api.getCruiseStats).toHaveBeenCalledTimes(1);
    expect(api.getCruiseStats).toHaveBeenCalledWith({ year: 2024 });
  });

  it("asks for the lifetime view when no year is chosen", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    await screen.findByText("stats:cruiseSection.countries");
    expect(api.getCruiseStats).toHaveBeenCalledWith(undefined);
  });

  it("sets the year against the compare year with a second request", async () => {
    api.getCruiseStats.mockImplementation(async (params?: { year?: number }) =>
      params?.year === 2023 ? { ...base, cruisesCount: 1 } : base
    );
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={{ year: 2024, compareYear: 2023 }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect(await screen.findByText("stats:yearFilter.vs")).toBeInTheDocument();
    expect(api.getCruiseStats).toHaveBeenCalledWith({ year: 2023 });
  });

  it("names the year when it had no cruise, instead of inviting a first one", async () => {
    api.getCruiseStats.mockResolvedValue({ ...base, cruisesCount: 0 });
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={{ year: 2019, compareYear: null }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect(await screen.findByText("stats:period.emptyYear")).toBeInTheDocument();
    expect(screen.queryByText("stats:cruiseSection.emptyTitle")).not.toBeInTheDocument();
  });
});

// The section menu reached every tab on 2026-09-16. Before, a cruise tab's cost
// block could not be hidden at all.
describe("CruiseStatsSection hides the blocks the reader switched off", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  it("drops a hidden block and keeps the rest", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={LIFETIME} visibility={hiding("regions", "tags")} />
      </MemoryRouter>
    );
    // The depth grid still draws, so the section did render.
    expect(await screen.findByText("stats:cruiseSection.countries")).toBeInTheDocument();
    expect(screen.queryByText("stats:cruiseSection.regionsHeading")).not.toBeInTheDocument();
    expect(screen.queryByText("United States of America")).not.toBeInTheDocument();
  });
});

// Measured on the beta, 2026-09-16: the strip was relabelled before the new
// year's figures arrived. It must name the year its figures belong to.
describe("CruiseStatsSection while the next year loads", () => {
  it("keeps naming the year its figures belong to, marked busy, until the new ones land", async () => {
    let resolve2024: (value: CruiseStatsResponse) => void = () => {};
    api.getCruiseStats.mockReset();
    api.getCruiseStats.mockImplementation((params?: { year?: number }) =>
      params?.year === 2024
        ? new Promise<CruiseStatsResponse>((r) => {
            resolve2024 = r;
          })
        : Promise.resolve(base)
    );

    const { rerender, container } = render(
      <MemoryRouter>
        <CruiseStatsSection scope={{ year: 2026, compareYear: 2025 }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect((await screen.findAllByText(/\(2025\)/)).length).toBeGreaterThan(0);

    rerender(
      <MemoryRouter>
        <CruiseStatsSection scope={{ year: 2026, compareYear: 2024 }} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    expect(screen.queryAllByText(/\(2024\)/)).toHaveLength(0);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();

    resolve2024(base);
    await waitFor(() => expect(screen.getAllByText(/\(2024\)/).length).toBeGreaterThan(0));
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });
});
