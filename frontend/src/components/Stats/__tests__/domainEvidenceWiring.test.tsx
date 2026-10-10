import { describe, it, expect, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import { EVIDENCE_MEASURES } from "../../../shared/evidenceMeasures";
import type { LodgingStats } from "../../../types/lodging";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#5ec2b2" }),
}));

import { LodgingStatStrip } from "../../Dashboard/tabs/lodging/LodgingStatStrip";
import LodgingGeoSection from "../lodging/LodgingGeoSection";
import LodgingRhythmSection from "../lodging/LodgingRhythmSection";
import LodgingRecordsSection from "../lodging/LodgingRecordsSection";
import LodgingMoneySection from "../lodging/LodgingMoneySection";
import LodgingQualitySection from "../lodging/LodgingQualitySection";
import LodgingLoyaltySection from "../lodging/LodgingLoyaltySection";
import PeriodComparisonStrip from "../PeriodComparisonStrip";
import { CruiseFunSection, CruiseRhythmSection } from "../cruise/CruiseDetailSections";
import { deriveCruiseStats, type CruiseStatsDetail } from "../../../lib/stats/cruiseStatsDetail";
import type { Cruise } from "../../../types/cruise";
import { expectNoNestedTriggers } from "./noNestedTriggers";

/**
 * Which tiles on the cruise, lodging and places surfaces open the evidence
 * panel (task 7b-3), read from the URL the tile itself writes rather than from
 * a prop — `?evidence=metric:<key>` is the whole contract between a tile and
 * the panel, so a tile wired to the wrong key looks identical to a correct one
 * until it is clicked.
 *
 * The lodging surfaces are the ones tested here because they are the ones
 * whose trigger is CONDITIONAL: every one of them takes an optional
 * `evidenceScope` and renders a plain `<div>` without it, so that the same
 * strip on the dashboard map and the lodging list page — where no period is
 * chosen — cannot open a panel scoped to a population that screen never shows.
 * A regression there would be silent: the tile would look right and answer a
 * different question. The cruise and places tiles are unconditional, and each
 * surface's own suite carries the same key check —
 * `CruiseStatsSection.countries.test.tsx` and `PoiStatsSection.test.tsx` both
 * gained an "evidence wiring" block in this task, because both already render
 * the whole section against a mocked API and repeating that here would be a
 * second fixture for one surface.
 *
 * The last assertion is the one that catches the defect this feature keeps
 * producing: every key a tile opens must be a REGISTERED measure that release
 * 1 serves. Wiring a tile on the strength of `servedIn: 1` alone ships a
 * pointer cursor over a 404 — that field records what release 1 INTENDS to
 * serve. `backend/src/services/evidence/__tests__/registryBinding.test.ts`
 * holds the other side.
 */

const lodgingStats = {
  lodgingsCount: 5,
  staysCount: 9,
  totalNights: 21,
  chainsUnique: 2,
  citiesUnique: 4,
  countriesCount: 3,
  countries: [],
  countriesByYear: {},
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 7,
  spendBaseTotal: 1234,
  spendByCurrency: { EUR: 1234 },
  spendBaseByCurrency: { EUR: 1234 },
  spendUnconvertedStays: 0,
  awardNights: 3,
  nightsByType: {},
  avgRatingOverall: 4.2,
  chainLoyaltyMax: 3,
  sameHotelRepeatMax: 2,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  nightsByStars: {},
  nightsByBoard: {},
  perfectStays: 2,
  enduredStays: 0,
  oneNightStays: 4,
  undatedStays: 0,
  undatedNights: 0,
  staysWithUnknownLength: 0,
  price: {
    avgPricePerNight: 80,
    medianPricePerNight: 75,
    pricedNights: 15,
    pricedStays: 6,
    unpricedStays: 0,
    cheapestNight: null,
    dearestNight: null,
    byYear: [],
    byCountry: [],
    byChain: [],
    byType: [],
    byBoard: [],
    awardNightsValue: 240,
  },
  ratings: { byChain: [], byCountry: [], byType: [], byStars: [], bestValue: [], worstValue: [] },
  geo: {
    continents: ["Europe", "Asia"],
    continentsCount: 2,
    northernmost: null,
    southernmost: null,
    centreOfGravity: null,
    topCities: [],
    topCountries: [],
    unlocatedStays: 0,
  },
  rhythm: {
    nightsAway: 19,
    walkableNights: 21,
    nightsByWeekday: [1, 2, 3, 4, 3, 3, 3],
    nightsByMonthOfYear: [1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2],
    nightsBySeason: { winter: 4, spring: 6, summer: 6, autumn: 3 },
    longestStreakNights: 7,
    longestStreak: null,
    longestGapDays: 40,
    awayShareByYear: {},
  },
  loyalty: { byChain: [], byProgramme: [], tiers: [] },
} as unknown as LodgingStats;

/** The same stats with ratings and chains, so the quality and loyalty sections draw their tiles. */
const ratedStats = {
  ...lodgingStats,
  ratings: {
    ...(lodgingStats as unknown as { ratings: object }).ratings,
    avgOverall: 4.2,
    avgRoom: 4,
    avgBreakfast: 3.5,
    avgService: 4.5,
    ratedStays: 6,
    unratedStays: 3,
  },
} as unknown as LodgingStats;

const chainStats = {
  ...lodgingStats,
  loyalty: {
    chainNights: 12,
    independentNights: 9,
    topChain: { name: "Rhein Hotels", nights: 8 },
    topChainShare: 0.6667,
    concentration: 0.5556,
    chainNightsRanked: [],
    lodgingNightsRanked: [],
    programmeYears: [],
  },
} as unknown as LodgingStats;

/** Reports the search string after each click — `MemoryRouter` never touches `window.location`. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

async function keysOpenedBy(section: JSX.Element): Promise<string[]> {
  // `screen` queries the whole document, so a previous render's buttons would
  // still be found here and would click a router this closure cannot see.
  cleanup();
  let search = "";
  render(
    <MemoryRouter>
      {section}
      <LocationProbe
        onChange={(next) => {
          search = next;
        }}
      />
    </MemoryRouter>
  );
  const keys: string[] = [];
  for (const trigger of screen.getAllByRole("button")) {
    await act(async () => {
      trigger.click();
    });
    const raw = new URLSearchParams(search).get("evidence") ?? "";
    keys.push(raw.slice(raw.indexOf(":") + 1));
  }
  return keys.sort();
}

const SCOPE = { period: "year", year: 2024 } as const;

describe("the lodging tiles open the measures they render", () => {
  it("the stat strip wires four cells, and leaves the chain and rating ones alone", async () => {
    const keys = await keysOpenedBy(
      <LodgingStatStrip stats={lodgingStats} variant="inline" evidenceScope={SCOPE} />
    );
    expect(keys).toEqual(
      ["lodgingsUniqueCount", "lodgingStaysCount", "lodgingNightsTotal", "lodgingSpendTotal"].sort()
    );
  });

  /**
   * The same strip on the dashboard map and the lodging list page. Without a
   * scope it must stay plain — a panel opened from there would be scoped to a
   * period that screen never chose, and would answer a different question
   * under the same number.
   */
  it("the same strip opens nothing where no period was chosen", async () => {
    cleanup();
    render(
      <MemoryRouter>
        <LodgingStatStrip stats={lodgingStats} variant="overlay" />
      </MemoryRouter>
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  /**
   * forgejo#258: every tile opens its entries. A count opens its own measure;
   * an extreme, an average or a centre opens the POPULATION it is read from —
   * the northernmost stay is a row among the stays with coordinates, the
   * longest streak a run in the nights away.
   */
  it("the geo, rhythm and records sections wire every tile", async () => {
    expect(
      await keysOpenedBy(<LodgingGeoSection stats={lodgingStats} evidenceScope={SCOPE} />)
    ).toEqual(
      [
        "lodgingContinentsCount",
        "lodgingLocatedStaysCount",
        "lodgingLocatedStaysCount",
        "lodgingLocatedStaysCount",
      ].sort()
    );
    expect(
      await keysOpenedBy(<LodgingRhythmSection stats={lodgingStats} evidenceScope={SCOPE} />)
    ).toEqual(Array(4).fill("lodgingNightsAwayTotal"));
    expect(
      await keysOpenedBy(<LodgingRecordsSection stats={lodgingStats} evidenceScope={SCOPE} />)
    ).toEqual(
      [
        "lodgingNightsTotal",
        "lodgingStaysCount",
        "lodgingOneNightStayCount",
        "lodgingPerfectStayCount",
      ].sort()
    );
  });

  it("the money, quality and loyalty sections open the population of every figure", async () => {
    expect(
      await keysOpenedBy(<LodgingQualitySection stats={ratedStats} evidenceScope={SCOPE} />)
    ).toEqual(Array(4).fill("lodgingRatedStaysCount"));
    expect(
      await keysOpenedBy(<LodgingLoyaltySection stats={chainStats} evidenceScope={SCOPE} />)
    ).toEqual(
      [
        "lodgingChainNightsTotal",
        "lodgingChainNightsTotal",
        "lodgingChainNightsTotal",
        "lodgingTopChainNights",
      ].sort()
    );
  });

  it("every key these surfaces open is a registered measure that release 1 serves", async () => {
    const keys = [
      ...(await keysOpenedBy(
        <LodgingStatStrip stats={lodgingStats} variant="inline" evidenceScope={SCOPE} />
      )),
      ...(await keysOpenedBy(<LodgingGeoSection stats={lodgingStats} evidenceScope={SCOPE} />)),
      ...(await keysOpenedBy(<LodgingRhythmSection stats={lodgingStats} evidenceScope={SCOPE} />)),
      ...(await keysOpenedBy(<LodgingRecordsSection stats={lodgingStats} evidenceScope={SCOPE} />)),
      ...(await keysOpenedBy(<LodgingMoneySection stats={lodgingStats} evidenceScope={SCOPE} />)),
      ...(await keysOpenedBy(<LodgingQualitySection stats={ratedStats} evidenceScope={SCOPE} />)),
      ...(await keysOpenedBy(<LodgingLoyaltySection stats={chainStats} evidenceScope={SCOPE} />)),
    ];
    expect(keys.filter((key) => EVIDENCE_MEASURES[key]?.servedIn !== 1)).toEqual([]);
  });

  /**
   * The scope travels out of band, not in the URL, so it needs its own look:
   * a tile that sent the wrong period would open a panel measuring a
   * population the tile never showed, and the URL would look identical.
   */
  it("sends the tile's own period as the scope", async () => {
    cleanup();
    const { useEvidenceOpenStore } = await import("../../evidence/evidenceOpenStore");
    render(
      <MemoryRouter>
        <LodgingRhythmSection stats={lodgingStats} evidenceScope={SCOPE} />
      </MemoryRouter>
    );
    await act(async () => {
      screen.getAllByRole("button")[0].click();
    });
    expect(useEvidenceOpenStore.getState().scope).toEqual({ period: "year", year: 2024 });
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(19);
  });
});

/**
 * The figures the owner ruled on for 2026-09-19 that do NOT sit in a tile of
 * their own: a number inside another card's sentence, and a figure in the
 * period strip. Both are conditional on a scope for the same reason the
 * strip above is — without one, the number stays prose.
 */
describe("the numbers inside a sentence, and the strip's own figures", () => {
  it("the money section opens the award NIGHTS from inside the value card's sentence", async () => {
    // Beside it, the award value opens the PAID nights it is priced at, and
    // the four price tiles the stays with a comparable price.
    expect(
      await keysOpenedBy(<LodgingMoneySection stats={lodgingStats} evidenceScope={SCOPE} />)
    ).toEqual(
      [
        "lodgingAwardNightsCount",
        "lodgingPaidNightsTotal",
        ...Array(4).fill("lodgingPricedNightsTotal"),
      ].sort()
    );
  });

  it("the same section opens nothing where no period was chosen", async () => {
    cleanup();
    render(
      <MemoryRouter>
        <LodgingMoneySection stats={lodgingStats} />
      </MemoryRouter>
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // And the sentence still reads whole — the tail is there either way.
    expect(screen.getByText(/lodging:stats.money.awardNightsAfter/)).toBeInTheDocument();
  });

  it("a strip figure opens its measure, and the rows without one stay prose", async () => {
    const rows = [
      { key: "stays", label: "Stays", current: 9, previous: 7 },
      {
        key: "countries",
        label: "Countries",
        current: 3,
        previous: 2,
        evidenceKey: "lodgingCountriesCount",
      },
    ];
    expect(
      await keysOpenedBy(
        <PeriodComparisonStrip
          year={2024}
          compareYear={2023}
          rows={rows}
          evidence={{ scope: SCOPE }}
        />
      )
    ).toEqual(["lodgingCountriesCount"]);
  });

  it("the same strip opens nothing without a scope, however many rows name a key", async () => {
    cleanup();
    render(
      <MemoryRouter>
        <PeriodComparisonStrip
          year={2024}
          compareYear={2023}
          rows={[
            {
              key: "countries",
              label: "Countries",
              current: 3,
              previous: 2,
              evidenceKey: "lodgingCountriesCount",
            },
          ]}
        />
      </MemoryRouter>
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  /**
   * A ranked list has no figure of its own, so the companions total — the
   * number of people, which is what the resolver answers — is drawn as a line
   * under the title. Ada sailed twice and is still one person (owner,
   * 2026-09-24); the total used to sum the bars and read 3 here.
   */
  it("the cruise companions total opens its measure and counts each person once", async () => {
    const detail = {
      first: null,
      mostPorts: null,
      highestDeck: null,
      onTrips: 0,
      cabinTypes: new Map<string, number>(),
      companions: new Map([
        ["Ada", 2],
        ["Grace", 1],
      ]),
    } as unknown as CruiseStatsDetail;
    cleanup();
    let search = "";
    render(
      <MemoryRouter>
        <CruiseFunSection detail={detail} accent="#5ec2b2" locale="de" evidenceScope={SCOPE} />
        <LocationProbe
          onChange={(next) => {
            search = next;
          }}
        />
      </MemoryRouter>
    );
    const total = screen.getByRole("button", { name: "cruise:stats.fun.companionsTotalLabel" });
    expect(total).toHaveTextContent("2");
    await act(async () => {
      total.click();
    });
    expect(new URLSearchParams(search).get("evidence")).toBe("metric:cruiseCompanionCount");
  });

  it("the same section leaves the total as prose where no period was chosen", async () => {
    cleanup();
    const detail = {
      first: null,
      mostPorts: null,
      highestDeck: null,
      onTrips: 0,
      cabinTypes: new Map<string, number>(),
      companions: new Map([["Ada", 2]]),
    } as unknown as CruiseStatsDetail;
    render(
      <MemoryRouter>
        <CruiseFunSection detail={detail} accent="#5ec2b2" locale="de" />
      </MemoryRouter>
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/cruise:stats.fun.companionsTotalAfter/)).toBeInTheDocument();
  });

  it("nests no trigger inside another, on either surface", async () => {
    cleanup();
    const detail = {
      first: null,
      mostPorts: null,
      highestDeck: null,
      onTrips: 0,
      cabinTypes: new Map<string, number>(),
      companions: new Map([["Ada", 2]]),
    } as unknown as CruiseStatsDetail;
    const money = render(
      <MemoryRouter>
        <LodgingMoneySection stats={lodgingStats} evidenceScope={SCOPE} />
      </MemoryRouter>
    );
    expectNoNestedTriggers(money.container);
    cleanup();
    const cruise = render(
      <MemoryRouter>
        <CruiseFunSection detail={detail} accent="#5ec2b2" locale="de" evidenceScope={SCOPE} />
      </MemoryRouter>
    );
    expectNoNestedTriggers(cruise.container);
  });
});

/**
 * forgejo#257: the rhythm and fun tiles of the cruise tab name one cruise or
 * an average; each opens the cruises its figure is read from, and none opens
 * anything where no period was chosen.
 */
describe("the cruise rhythm and fun tiles open their populations", () => {
  const cruise = (over: Partial<Cruise>): Cruise =>
    ({
      id: "c",
      status: "completed",
      startDate: "2024-05-01",
      endDate: "2024-05-08",
      stops: [],
      companions: [],
      deck: null,
      tripId: null,
      price: null,
      currency: null,
      ...over,
    }) as unknown as Cruise;
  const detail = deriveCruiseStats([
    cruise({
      id: "a",
      deck: 9,
      tripId: "t1",
      stops: [{ isAtSea: false }, { isAtSea: true }] as Cruise["stops"],
    }),
    cruise({ id: "b", status: "scheduled", startDate: "2027-06-01", endDate: "2027-06-04" }),
    cruise({ id: "x", status: "cancelled", startDate: null, endDate: null }),
  ]);

  it("names what the fold keeps that has not sailed", () => {
    expect([detail.bookedCount, detail.cancelledCount, detail.undatedCount]).toEqual([1, 1, 1]);
  });

  it("wires the four rhythm tiles and the four fun cards", async () => {
    expect(
      await keysOpenedBy(
        <CruiseRhythmSection detail={detail} accent="#5ec2b2" locale="de" evidenceScope={SCOPE} />
      )
    ).toEqual(["cruiseDatedCount", ...Array(3).fill("cruiseNightsTotal")].sort());
    expect(
      await keysOpenedBy(
        <CruiseFunSection detail={detail} accent="#5ec2b2" locale="de" evidenceScope={SCOPE} />
      )
    ).toEqual(
      [
        "cruiseDatedCount",
        "cruiseDeckRecordedCount",
        "cruiseListedPortCallsTotal",
        "cruiseOnTripCount",
      ].sort()
    );
  });

  it("every key they open is served, and none opens without a period", async () => {
    const keys = [
      ...(await keysOpenedBy(
        <CruiseRhythmSection detail={detail} accent="#5ec2b2" locale="de" evidenceScope={SCOPE} />
      )),
      ...(await keysOpenedBy(
        <CruiseFunSection detail={detail} accent="#5ec2b2" locale="de" evidenceScope={SCOPE} />
      )),
    ];
    expect(keys.filter((key) => EVIDENCE_MEASURES[key]?.servedIn !== 1)).toEqual([]);
    cleanup();
    render(
      <MemoryRouter>
        <CruiseRhythmSection detail={detail} accent="#5ec2b2" locale="de" />
        <CruiseFunSection detail={detail} accent="#5ec2b2" locale="de" />
      </MemoryRouter>
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
