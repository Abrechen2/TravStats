import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Lodging, LodgingFacets, LodgingStats, LodgingStay } from "../../types/lodging";
import { countRenderedRows, paginationControlsRendered } from "./tablePaginationTestSupport";

const listLodgingPageMock = vi.fn();
const getLodgingFacetsMock = vi.fn();
const getLodgingStatsMock = vi.fn();
const deleteLodgingMock = vi.fn();
const navigateMock = vi.fn();

// The row navigates, so proving that a row action does NOT navigate needs a
// spy on the navigator itself — MemoryRouter alone would swallow the move.
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const defaultStats: LodgingStats = {
  lodgingsCount: 1,
  staysCount: 1,
  totalNights: 2,
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 2,
  chainsUnique: 0,
  citiesUnique: 1,
  countries: ["DE"],
  countriesCount: 1,
  countriesByYear: {},
  spendBaseTotal: 883,
  spendByCurrency: { EUR: 883 },
  spendUnconvertedStays: 0,
  spendBaseByCurrency: { EUR: 883 },
  awardNights: 0,
  nightsByType: { hotel: 2 },
  avgRatingOverall: null,
  chainLoyaltyMax: 0,
  sameHotelRepeatMax: 1,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  ...EMPTY_LODGING_STATS_BLOCKS,
};

vi.mock("../../lib/api/lodging", () => ({
  listLodgingPage: (...args: unknown[]) => listLodgingPageMock(...args),
  getLodgingFacets: (...args: unknown[]) => getLodgingFacetsMock(...args),
  getLodgingStats: () => getLodgingStatsMock(),
  deleteLodging: (...args: unknown[]) => deleteLodgingMock(...args),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/lodging/LodgingFormModal", () => ({
  LodgingFormModal: () => null,
}));

// The import log used to render (and fetch) on this page; it now lives in
// the central import hub. The stub stays so this file never hits the real
// (unmocked) network through any remaining lodging-import client. The log's
// own behaviour is covered by ImportLogSection.test.tsx.
vi.mock("../../lib/api/lodgingImport", () => ({
  listLodgingImportBatches: vi.fn().mockResolvedValue([]),
  revertLodgingImportBatch: vi.fn(),
}));

// Use the real settingsStore so we can `setState` a divergent baseCurrency
// vs units.currency, mirroring LodgingDetailPage.test.tsx.
vi.unmock("../../store/settingsStore");

// Imported after the mocks above so the module graph picks them up.
import LodgingListPage from "../LodgingListPage";
import { useSettingsStore } from "../../store/settingsStore";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../types/lodgingStatsFixture";

// Measured 2026-09-19: this page's paged-rows case renders in about a second
// on a developer machine and past Vitest's 5 s default on the CI runner under
// coverage instrumentation — the merge dbcda8d2 went red on exactly that.
// A hang is still caught at 20 s; a slow render is not a wrong render.
vi.setConfig({ testTimeout: 20_000 });

/**
 * The FX snapshot half of a CONVERTED stay.
 *
 * A lodging's `totalSpendBase` is the sum of its stays' `totalPriceBase`, so a
 * fixture pairing a non-zero total with stays that carry no snapshot describes
 * a row the backend cannot produce — and the spend cell now reads the stays to
 * tell "converted to zero" from "nothing converted at all".
 */
const CONVERTED = {
  totalPriceBase: 883,
  fxRate: 1.0512,
  fxRateDate: "2024-01-01T00:00:00.000Z",
  fxBaseCurrency: "EUR",
  fxSource: "ecb",
} as const;

function makeStay(overrides: Partial<LodgingStay> = {}): LodgingStay {
  return {
    id: "stay-1",
    lodgingId: "lodging-1",
    userId: "user-1",
    tripId: null,
    bookingId: null,
    checkInTime: null,
    checkOutTime: null,
    checkIn: "2024-01-01T00:00:00.000Z",
    checkOut: "2024-01-02T00:00:00.000Z",
    datePrecision: "DAY" as const,
    nights: null,
    status: "completed",
    roomNumber: null,
    roomCategory: null,
    board: "none",
    pricePerNight: null,
    currency: "EUR",
    totalPrice: null,
    totalPriceBase: null,
    fxRate: null,
    fxRateDate: null,
    fxBaseCurrency: null,
    fxSource: null,
    isAwardStay: false,
    ratingRoom: null,
    ratingBreakfast: null,
    ratingService: null,
    ratingOverall: null,
    roomAmenities: [],
    bookingReference: null,
    membershipId: null,
    membershipOptOut: false,
    receiptUrl: null,
    guests: null,
    companions: [],
    notes: null,
    parserTemplate: null,
    parserConfidence: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: "lodging-1",
    userId: "user-1",
    type: "hotel",
    name: "Hotel Test Ludwigsburg",
    chainId: null,
    chain: null,
    address: null,
    city: "Ludwigsburg",
    country: "DE",
    isoCountryCode: null,
    lat: 48.9,
    lon: 9.19,
    stars: 4,
    amenities: [],
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    stays: [],
    overallRating: null,
    stayCount: 1,
    nights: 2,
    totalSpendBase: 883,
    totalSpendBaseByCurrency: { EUR: 883 },
    ...overrides,
  };
}

/**
 * Type and country moved behind the "Filter" button (owner ask, 2026-08-22):
 * search, status and year stay open because every domain has them, everything
 * one domain owns sits in the panel. The controls are the same controls.
 */
async function openFilterPanel(): Promise<void> {
  await userEvent.click(await screen.findByTestId("list-filter-more"));
}

function renderListPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LodgingListPage />
    </MemoryRouter>
  );
}

/**
 * One page of rows, and the size of the set it came from.
 *
 * The page asks the SERVER for its rows, its order and its counts since
 * 2026-09-20; before that it walked every page of the library into memory and
 * did all three here. Every fixture below therefore describes a RESPONSE, not
 * a library — which is also why `total` defaults to the row count rather than
 * being inferred from anything.
 */
const mockRows = (rows: Lodging[], total = rows.length): void => {
  listLodgingPageMock.mockResolvedValue({ rows, total });
};

/** Facets that agree with a set of rows, for the tests that do not care. */
const mockFacets = (over: Partial<LodgingFacets> = {}): void => {
  getLodgingFacetsMock.mockResolvedValue({
    countries: [],
    years: [],
    types: [],
    statuses: [],
    summary: { lodgings: 0, stays: 0, nights: 0, chains: 0 },
    ...over,
  });
};

describe("LodgingListPage", () => {
  beforeEach(() => {
    listLodgingPageMock.mockReset();
    getLodgingFacetsMock.mockReset();
    mockRows([]);
    mockFacets();
    getLodgingStatsMock.mockReset();
    getLodgingStatsMock.mockResolvedValue(defaultStats);
    useSettingsStore.setState({
      baseCurrency: "EUR",
      units: { distanceUnit: "kilometers" },
    });
  });

  it("labels totalSpendBase with the real baseCurrency, not a differing units.currency", async () => {
    // totalSpendBase is a base-currency figure (CHF here) computed by the
    // backend. Units→Currency is a separate, independently-set display
    // preference (USD here) used elsewhere for flight costs — it must not
    // leak into this column.
    useSettingsStore.setState({
      baseCurrency: "CHF",
      units: { distanceUnit: "kilometers" },
    });
    mockRows([
      makeLodging({
        stays: [makeStay({ totalPrice: 883, currency: "CHF", ...CONVERTED })],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });

    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    expect(row?.textContent).toMatch(/CHF/);
    expect(row?.textContent).not.toMatch(/\$883/);
  });

  it("shows an honest hint when a lodging has spend snapshotted under an older base currency (finding 2)", async () => {
    mockRows([
      makeLodging({
        totalSpendBase: 100, // only the CHF (current base) slice
        totalSpendBaseByCurrency: { EUR: 200, CHF: 100 },
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    expect(row?.querySelector('[title="lodging:list.otherCurrencyHint"]')).toBeInTheDocument();
  });

  it("shows no hint when all of a lodging's spend is in the current base currency", async () => {
    mockRows([makeLodging({ totalSpendBase: 883, totalSpendBaseByCurrency: { EUR: 883 } })]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    expect(row?.querySelector('[title="lodging:list.otherCurrencyHint"]')).not.toBeInTheDocument();
  });

  it("puts the facet's count on every type and status option, zero included", async () => {
    // The endpoint counted these from the day it existed and nothing read
    // them: the two dropdowns are closed vocabularies drawn from constants, so
    // the counts were measured for nobody. They are the option's own label
    // now — including the zero, which says an option returns nothing BEFORE it
    // is clicked rather than after.
    mockRows([]);
    mockFacets({
      types: [
        { type: "hotel", count: 12 },
        { type: "hostel", count: 2 },
      ],
      statuses: [{ status: "completed", count: 9 }],
    });

    renderListPage();
    await openFilterPanel();

    const types = (await screen.findByLabelText("lodging:filter.type")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(types.options).map((o) => o.textContent)).toEqual([
        "lodging:filter.allTypes",
        "lodging:type.hotel (12)",
        "lodging:type.campsite (0)",
        "lodging:type.guesthouse (0)",
        "lodging:type.apartment (0)",
        "lodging:type.hostel (2)",
      ]);
    });

    const statuses = screen.getByLabelText("lodging:list.status.label") as HTMLSelectElement;
    expect(Array.from(statuses.options).map((o) => o.textContent)).toEqual([
      "lodging:filter.allStatuses",
      "lodging:stayStatus.in_progress (0)",
      "lodging:stayStatus.scheduled (0)",
      "lodging:stayStatus.completed (9)",
      "lodging:stayStatus.cancelled (0)",
    ]);
  });

  it("offers all five lodging types (plus 'all') in the type filter", async () => {
    mockRows([]);

    renderListPage();

    await openFilterPanel();
    const select = (await screen.findByLabelText("lodging:filter.type")) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["all", "hotel", "campsite", "guesthouse", "apartment", "hostel"]);
  });

  it("sends every active filter to the server, and asks the facets for the options", async () => {
    // The dropdown options came from a SECOND, unfiltered walk of the whole
    // library; they come from `/lodging/facets` now, counted under the other
    // filters. Nothing here derives an option from a row.
    mockFacets({
      years: [
        { year: 2024, count: 1 },
        { year: 2023, count: 1 },
      ],
      countries: [
        { value: "CH", isoCode: "CH", count: 1 },
        { value: "US", isoCode: "US", count: 1 },
      ],
    });
    mockRows([]);

    const user = userEvent.setup();
    renderListPage();

    await screen.findByRole("option", { name: "2024" });
    listLodgingPageMock.mockClear();

    await openFilterPanel();
    await user.selectOptions(screen.getByLabelText("lodging:filter.type"), "campsite");
    await waitFor(() => {
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite" })
      );
    });

    listLodgingPageMock.mockClear();
    await user.selectOptions(screen.getByLabelText("lodging:filter.year"), "2023");
    await waitFor(() => {
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite", year: 2023 })
      );
    });

    listLodgingPageMock.mockClear();
    await openFilterPanel();
    await user.selectOptions(screen.getByLabelText("lodging:filter.country"), "US");
    await waitFor(() => {
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite", year: 2023, country: "US" })
      );
    });

    // The facet call carries the same filters and never the page or the sort —
    // turning a page changes no count, and asking again would double the work.
    const facetCalls = getLodgingFacetsMock.mock.calls;
    const facetCall = facetCalls[facetCalls.length - 1][0] as Record<string, unknown>;
    expect(facetCall).toMatchObject({ type: "campsite", year: 2023, country: "US" });
    expect(facetCall).not.toHaveProperty("limit");
    expect(facetCall).not.toHaveProperty("sort");
  });

  it("filters by status through the query, not by hiding rows it already has", async () => {
    // The status pill is derived from the stays, so this filter used to be the
    // one that COULD NOT be a query parameter — it was applied here, over the
    // complete set the server had returned. With one page in hand that is no
    // longer possible, and `shared/lodgingLifecycle.ts` is now the rule on
    // both sides.
    mockRows([]);
    mockFacets();
    const user = userEvent.setup();
    renderListPage();

    await waitFor(() => expect(listLodgingPageMock).toHaveBeenCalled());
    listLodgingPageMock.mockClear();

    await user.selectOptions(screen.getByLabelText("lodging:list.status.label"), "scheduled");
    await waitFor(() => {
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "scheduled" })
      );
    });
  });

  it("asks the server for the order, and flips it on a second click of the same header", async () => {
    // Sorting was done here, over rows the browser held — safe only because it
    // held ALL of them. A page cannot be sorted into the right order, so the
    // header now names a sort key in the query. The DEFAULT is unchanged:
    // newest stay first, so every domain list opens the same way.
    mockRows([
      makeLodging({ id: "l-1", name: "Zebra Lodge" }),
      makeLodging({ id: "l-2", name: "Alpha Inn" }),
    ]);
    mockFacets();

    const user = userEvent.setup();
    const { container } = renderListPage();

    await waitFor(() => {
      expect(container.querySelectorAll(".ts-table-row").length).toBe(2);
    });
    expect(listLodgingPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "lastStay", order: "desc" })
    );

    // The rows are rendered in the order they ARRIVED — re-sorting them here
    // would reorder one page inside a set ordered by something else.
    const rowNames = Array.from(container.querySelectorAll(".ts-table-row")).map(
      (row) => row.querySelector('[role="cell"]')?.textContent ?? ""
    );
    expect(rowNames[0]).toContain("Zebra Lodge");
    expect(rowNames[1]).toContain("Alpha Inn");

    listLodgingPageMock.mockClear();
    await user.click(screen.getByText("lodging:list.columns.nights"));
    await waitFor(() => {
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "nights", order: "desc" })
      );
    });

    listLodgingPageMock.mockClear();
    await user.click(screen.getByText("lodging:list.columns.nights"));
    await waitFor(() => {
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "nights", order: "asc" })
      );
    });
  });

  it("does not call itself filtered before the search it is showing was sent", async () => {
    // `hasActiveFilter` drives the strip's "gefiltert" note and the empty
    // state's wording, and both describe the answer ON SCREEN — which came
    // from the query the server was last asked. Reading the live input put the
    // page into its filtered wording for the 300 ms before the search had been
    // sent, so an empty library blamed a filter that was not yet applied.
    mockRows([]);
    mockFacets();
    const user = userEvent.setup();
    renderListPage();

    await screen.findByText("lodging:list.empty");
    await user.type(screen.getByPlaceholderText("lodging:filter.searchPlaceholder"), "adlon");

    // Typed, not yet debounced, not yet sent: still the plain empty state.
    expect(screen.getByText("lodging:list.empty")).toBeInTheDocument();

    // Once the search reaches the server, the wording follows it.
    await waitFor(() => {
      expect(listLodgingPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: "adlon" })
      );
    });
    await screen.findByText("common:filters.noMatch");
  });

  it("renders the empty state without crashing when there are no lodgings", async () => {
    mockRows([]);

    renderListPage();

    expect(await screen.findByText("lodging:list.empty")).toBeInTheDocument();
  });

  it("shows the original currency amount with the converted total beneath it (mockup screen ①)", async () => {
    mockRows([
      makeLodging({
        totalSpendBase: 883,
        totalSpendBaseByCurrency: { EUR: 883 },
        stays: [makeStay({ totalPrice: 840, currency: "CHF", ...CONVERTED })],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    expect(row?.textContent).toMatch(/840/);
    expect(row?.textContent).toMatch(/CHF/);
    expect(row?.textContent).toMatch(/≈/);
    expect(row?.textContent).toMatch(/883/);
  });

  it("says 'kein Kurs' instead of 0 € when nothing on the lodging could be converted", async () => {
    // The row used to render "$780 ≈ 0 €" — the zero is the empty sum, not a
    // price, and pairing it with a real amount makes it look like arithmetic.
    mockRows([
      makeLodging({
        totalSpendBase: 0,
        totalSpendBaseByCurrency: {},
        stays: [makeStay({ totalPrice: 780, currency: "USD" })],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    expect(row?.textContent).toMatch(/780/);
    expect(row?.textContent).toContain("lodging:fx.markerNone");
    expect(row?.textContent).not.toMatch(/≈/);
  });

  it("says how many stays a partly converted total leaves out", async () => {
    // One stay converted, one not: the figure is real but incomplete, and the
    // row used to show it bare — indistinguishable from a complete one.
    mockRows([
      makeLodging({
        totalSpendBase: 883,
        totalSpendBaseByCurrency: { EUR: 883 },
        stays: [
          makeStay({ totalPrice: 840, currency: "CHF", ...CONVERTED }),
          // Dollars with no snapshot. A EUR amount here would need no rate at
          // all and would be IN the 883 — a footnote naming it would describe
          // a row the figure already counts (shared/lodgingSpendBase.ts).
          makeStay({ id: "stay-2", totalPrice: 1120, currency: "USD" }),
        ],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    expect(row?.textContent).toMatch(/883/);
    expect(row?.textContent).toContain("lodging:fx.omittedFromTotal");
  });

  /**
   * Every stay entered before the FX columns shipped carries no snapshot, and
   * a stay priced in the base currency needs none — the backend counts it, so
   * the footnote must not name it. It used to, because this side asked only
   * whether a snapshot existed: the row showed a complete total and a line
   * underneath claiming it had left that very amount out.
   */
  it("names no omitted stay for a base-currency price that carries no snapshot", async () => {
    mockRows([
      makeLodging({
        totalSpendBase: 1120,
        totalSpendBaseByCurrency: { EUR: 1120 },
        stays: [
          makeStay({ totalPrice: 840, currency: "CHF", ...CONVERTED }),
          makeStay({ id: "stay-2", totalPrice: 1120, currency: "EUR" }),
        ],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    expect(row?.textContent).toMatch(/1[.,]?120/);
    expect(row?.textContent).not.toContain("lodging:fx.omittedFromTotal");
    // Nor the stronger claim that NOTHING converted.
    expect(row?.textContent).not.toContain("lodging:fx.markerNone");
  });

  it("renders — (not 0 €) in the spend column when every stay's price has been cleared", async () => {
    mockRows([
      makeLodging({
        totalSpendBase: 0,
        totalSpendBaseByCurrency: {},
        stays: [makeStay({ totalPrice: null })],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    // The spend cell must read "—", never a false "0 €" (a cleared price is
    // not the same as a confirmed free stay).
    // Positional index — it moved by one when the "Letzter Aufenthalt" column
    // was added on 2026-08-25, and the index here was NOT moved with it: [7]
    // is the rating cell, which also reads "—", so this passed for a year
    // without looking at the spend cell at all (found while fixing forgejo#82).
    // Indexing cells by number is brittle; it is kept only because this
    // assertion is about the spend cell's CONTENT.
    const spendCell = row?.querySelectorAll('[role="cell"]')[8];
    expect(spendCell?.textContent).toBe("—");
  });

  it("renders — (never 0 €) when the only priced stay is still planned", async () => {
    // forgejo#82: the cell chose its branch from ALL stays but printed the
    // visited-only aggregate. A planned, priced stay passed `hasAnyPrice`,
    // fell through to the converted total, and the row read "0 €" — a hotel
    // not yet slept in, reported as free. The price is not dropped either:
    // it gets its own "planned" line.
    mockRows([
      makeLodging({
        totalSpendBase: 0,
        totalSpendBaseByCurrency: {},
        stays: [
          makeStay({
            status: "scheduled",
            checkIn: "2099-09-07T00:00:00.000Z",
            checkOut: "2099-09-08T00:00:00.000Z",
            totalPrice: 149.9,
            currency: "EUR",
            totalPriceBase: 149.9,
            fxBaseCurrency: "EUR",
            fxRate: 1,
            fxRateDate: "2026-01-01",
          }),
        ],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest('[role="row"]');
    const spendCell = row?.querySelectorAll('[role="cell"]')[8];
    expect(spendCell?.textContent).not.toMatch(/0\s?€/);
    expect(spendCell?.textContent).toMatch(/^—/);
    expect(spendCell?.textContent).toContain("lodging:list.spendPlanned");
  });

  it("surfaces an error state (not a blank page) when the page fetch fails", async () => {
    // Only the PAGE fetch drives the alert. A facet call that fails leaves the
    // strip and the dropdowns quiet — a table with rows in it is not an error
    // because nobody could count them.
    listLodgingPageMock.mockRejectedValue(new Error("network failure"));

    renderListPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("lodging:list.loadError");
    // The failure must not silently render as if there were zero lodgings —
    // the error alert state supersedes the empty state.
    expect(screen.queryByText("lodging:list.empty")).not.toBeInTheDocument();
  });

  // Bulk import is central (Settings → Import); this page only links there.
  // The CSV tile used to render below the list, which is the arrangement the
  // 2.5.0 import hub replaced everywhere else.
  it("links to the central import hub instead of embedding the CSV tile", async () => {
    mockRows([]);
    renderListPage();

    const hubLink = await screen.findByRole("link", { name: /settings:import\.openHub/ });
    expect(hubLink).toHaveAttribute("href", "/settings/data?section=import");
    expect(screen.queryByText("lodging:import.csv.title")).not.toBeInTheDocument();
  });

  // Three controls used to sit here — "Importieren", "Buchung einlesen" and
  // "Hotel hinzufügen" — two of which said "import" and were reported as
  // indistinguishable in Discord on 2026-08-03. Distinguishing the labels was
  // treating the symptom: reading a booking is not a separate act, it is the
  // first ROUTE into adding one. One button now, and the confusion cannot
  // recur because the second button no longer exists.
  it("offers exactly one way to add, with no rival import button beside it", async () => {
    mockRows([]);
    renderListPage();

    expect(await screen.findByRole("button", { name: /lodging:add\.title/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /import:lodging\.triggerLabel/ })
    ).not.toBeInTheDocument();
    // The hub stays reachable, but as a quiet link — never a competing button.
    expect(
      screen.queryByRole("button", { name: /settings:import\.openHub/ })
    ).not.toBeInTheDocument();
  });
  // The list had no actions at all: editing meant opening the house first,
  // and deleting was only possible from the detail page. Flights and cruises
  // both acted from the row, so the same job took a different number of
  // clicks depending on which list you were standing in.
  describe("row actions", () => {
    it("edits and deletes from the row", async () => {
      const lodging = makeLodging({ id: "l1", name: "Hotel Adlon", stayCount: 3 });
      mockRows([lodging]);
      deleteLodgingMock.mockResolvedValue(undefined);
      renderListPage();

      await screen.findByText("Hotel Adlon");
      expect(screen.getByTestId("lodging-edit-l1")).toBeInTheDocument();

      await userEvent.click(screen.getByTestId("lodging-delete-l1"));

      // The dialog must name the stays that go with the house — deleting one
      // takes its whole history, and the list is where a mis-click is easiest.
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(deleteLodgingMock).not.toHaveBeenCalled();

      // Scoped to the dialog: the row's own delete icon carries the same name.
      await userEvent.click(within(dialog).getByRole("button", { name: /common:buttons\.delete/ }));
      await waitFor(() => expect(deleteLodgingMock).toHaveBeenCalledWith("l1"));
    });

    it("does not open the lodging when an action is clicked", async () => {
      mockRows([makeLodging({ id: "l1", name: "Hotel Adlon" })]);
      renderListPage();

      await screen.findByText("Hotel Adlon");
      await userEvent.click(screen.getByTestId("lodging-delete-l1"));

      // The row navigates; without stopPropagation the delete click would
      // also open the very lodging it is about to remove.
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  // Review finding (Alex T7, round 1): nothing tested that the wiring
  // actually pages the rows — reverting `filtered.map` -> `pagination.paged.map`
  // or dropping `<TablePagination>` would have left the suite green.
  it("renders the page the server sent, and says how large the whole set is", async () => {
    // Reverting to a client-side slice would show 63 rows here, and reverting
    // the summary to a sum over them would print 25 where the library has 63.
    const page = Array.from({ length: 25 }, (_, i) =>
      makeLodging({ id: `l-${i}`, name: `Hotel ${i}`, stayCount: 0, nights: 0 })
    );
    mockRows(page, 63);
    mockFacets({ summary: { lodgings: 63, stays: 71, nights: 104, chains: 4 } });

    const { container } = renderListPage();

    await waitFor(() => {
      expect(countRenderedRows(container)).toBe(25);
    });
    expect(paginationControlsRendered()).toBe(true);
    // The FULL set's figures, counted by the database — not the page's.
    expect(screen.getByText("63")).toBeInTheDocument();
    expect(screen.getByText("104")).toBeInTheDocument();
  });

  it("offers no 'Alle' page size — over a network it would mean 'the first 500'", async () => {
    mockRows([makeLodging({ id: "l-1" })], 1);
    mockFacets();
    renderListPage();

    const sizes = (await screen.findByLabelText(
      "common:table.pagination.pageSize"
    )) as HTMLSelectElement;
    expect(Array.from(sizes.options).map((o) => o.value)).toEqual(["25", "50", "100"]);
  });
});
