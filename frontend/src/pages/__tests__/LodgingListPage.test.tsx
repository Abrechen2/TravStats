import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Lodging, LodgingStats, LodgingStay } from "../../types/lodging";

const listLodgingsMock = vi.fn();
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
  listLodgings: (...args: unknown[]) => listLodgingsMock(...args),
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

describe("LodgingListPage", () => {
  beforeEach(() => {
    listLodgingsMock.mockReset();
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
    listLodgingsMock.mockResolvedValue([
      makeLodging({
        stays: [makeStay({ totalPrice: 883, currency: "CHF", ...CONVERTED })],
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });

    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    expect(row?.textContent).toMatch(/CHF/);
    expect(row?.textContent).not.toMatch(/\$883/);
  });

  it("shows an honest hint when a lodging has spend snapshotted under an older base currency (finding 2)", async () => {
    listLodgingsMock.mockResolvedValue([
      makeLodging({
        totalSpendBase: 100, // only the CHF (current base) slice
        totalSpendBaseByCurrency: { EUR: 200, CHF: 100 },
      }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    expect(row?.querySelector('[title="lodging:list.otherCurrencyHint"]')).toBeInTheDocument();
  });

  it("shows no hint when all of a lodging's spend is in the current base currency", async () => {
    listLodgingsMock.mockResolvedValue([
      makeLodging({ totalSpendBase: 883, totalSpendBaseByCurrency: { EUR: 883 } }),
    ]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    expect(row?.querySelector('[title="lodging:list.otherCurrencyHint"]')).not.toBeInTheDocument();
  });

  it("offers all five lodging types (plus 'all') in the type filter", async () => {
    listLodgingsMock.mockResolvedValue([]);

    renderListPage();

    await openFilterPanel();
    const select = (await screen.findByLabelText("lodging:filter.type")) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["all", "hotel", "campsite", "guesthouse", "apartment", "hostel"]);
  });

  it("passes the active type/year/country filters and sort as query params to listLodgings", async () => {
    // Baseline (the unfiltered fetch used only to derive the year/country
    // dropdown option sets) needs distinct countries/years so those
    // <select>s have real, non-"all" options to pick below.
    const baseline: Lodging[] = [
      makeLodging({
        id: "l-ch",
        country: "CH",
        stays: [makeStay({ checkIn: "2023-05-01T00:00:00.000Z" })],
      }),
      makeLodging({
        id: "l-us",
        country: "US",
        stays: [makeStay({ checkIn: "2024-06-01T00:00:00.000Z" })],
      }),
    ];
    listLodgingsMock.mockResolvedValue(baseline);

    const user = userEvent.setup();
    renderListPage();

    // Wait for the initial baseline + reload fetches to settle and the
    // dropdown options to be populated from `baseline`.
    await screen.findByRole("option", { name: "2024" });
    listLodgingsMock.mockClear();

    await openFilterPanel();
    await user.selectOptions(screen.getByLabelText("lodging:filter.type"), "campsite");
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalledWith(expect.objectContaining({ type: "campsite" }));
    });

    listLodgingsMock.mockClear();
    await user.selectOptions(screen.getByLabelText("lodging:filter.year"), "2023");
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite", year: 2023 })
      );
    });

    listLodgingsMock.mockClear();
    await openFilterPanel();
    await user.selectOptions(screen.getByLabelText("lodging:filter.country"), "US");
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite", year: 2023, country: "US" })
      );
    });

    // Sorting is client-side now (header clicks) — the server query must
    // NEVER carry a sort key again, or the fetch and the headers would fight
    // over the order.
    for (const call of listLodgingsMock.mock.calls) {
      expect(call[0]).not.toHaveProperty("sort");
    }
  });

  it("sorts client-side: newest stay first by default, header click re-sorts", async () => {
    // Owner ask (2026-08-20): sorting moved into the column headers,
    // flights-table style. Client-side is safe here because listLodgings
    // returns the COMPLETE set, never one paginated slice.
    //
    // The DEFAULT changed on 2026-08-25 from "name ascending" to "newest stay
    // first", so every domain list opens the same way. A hotel carries no date
    // of its own, so the stay supplies it — and a PLANNED stay counts as the
    // newest, which is why Zebra (2099) leads and not Alpha (2024).
    const stay = (checkIn: string) =>
      ({
        id: `s-${checkIn}`,
        checkIn,
        checkOut: null,
        datePrecision: "DAY",
        nights: null,
      }) as never;
    const ordered: Lodging[] = [
      makeLodging({
        id: "l-1",
        name: "Zebra Lodge",
        nights: 1,
        totalSpendBase: 500,
        stays: [stay("2099-01-01")],
      }),
      makeLodging({
        id: "l-2",
        name: "Alpha Inn",
        nights: 9,
        totalSpendBase: 10,
        stays: [stay("2024-01-01")],
      }),
      makeLodging({
        id: "l-3",
        name: "Mid Motel",
        nights: 4,
        totalSpendBase: 250,
        stays: [stay("2026-01-01")],
      }),
    ];
    listLodgingsMock.mockResolvedValue(ordered);

    const user = userEvent.setup();
    const { container } = renderListPage();

    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBe(3);
    });

    const rowNames = (): string[] =>
      Array.from(container.querySelectorAll("tbody tr")).map(
        (row) => row.querySelector("td")?.textContent ?? ""
      );
    expect(rowNames()[0]).toContain("Zebra Lodge");
    expect(rowNames()[1]).toContain("Mid Motel");
    expect(rowNames()[2]).toContain("Alpha Inn");

    // Clicking the nights header sorts by nights, descending first. (The
    // global t-mock is identity, so every header button shares the same
    // aria-label — target the header by its visible label text instead.)
    await user.click(screen.getByText("lodging:list.columns.nights"));
    expect(rowNames()[0]).toContain("Alpha Inn");
    expect(rowNames()[1]).toContain("Mid Motel");
    expect(rowNames()[2]).toContain("Zebra Lodge");

    // Same header again flips the direction.
    await user.click(screen.getByText("lodging:list.columns.nights"));
    expect(rowNames()[0]).toContain("Zebra Lodge");
  });

  it("renders the empty state without crashing when there are no lodgings", async () => {
    listLodgingsMock.mockResolvedValue([]);

    renderListPage();

    expect(await screen.findByText("lodging:list.empty")).toBeInTheDocument();
  });

  it("shows the original currency amount with the converted total beneath it (mockup screen ①)", async () => {
    listLodgingsMock.mockResolvedValue([
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
    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    expect(row?.textContent).toMatch(/840/);
    expect(row?.textContent).toMatch(/CHF/);
    expect(row?.textContent).toMatch(/≈/);
    expect(row?.textContent).toMatch(/883/);
  });

  it("says 'kein Kurs' instead of 0 € when nothing on the lodging could be converted", async () => {
    // The row used to render "$780 ≈ 0 €" — the zero is the empty sum, not a
    // price, and pairing it with a real amount makes it look like arithmetic.
    listLodgingsMock.mockResolvedValue([
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
    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    expect(row?.textContent).toMatch(/780/);
    expect(row?.textContent).toContain("lodging:fx.markerNone");
    expect(row?.textContent).not.toMatch(/≈/);
  });

  it("says how many stays a partly converted total leaves out", async () => {
    // One stay converted, one not: the figure is real but incomplete, and the
    // row used to show it bare — indistinguishable from a complete one.
    listLodgingsMock.mockResolvedValue([
      makeLodging({
        totalSpendBase: 883,
        totalSpendBaseByCurrency: { EUR: 883 },
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
    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    expect(row?.textContent).toMatch(/883/);
    expect(row?.textContent).toContain("lodging:fx.omittedFromTotal");
  });

  it("renders — (not 0 €) in the spend column when every stay's price has been cleared", async () => {
    listLodgingsMock.mockResolvedValue([
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
    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    // The spend cell must read "—", never a false "0 €" (a cleared price is
    // not the same as a confirmed free stay).
    // Positional index — it moved by one when the "Letzter Aufenthalt" column
    // was added on 2026-08-25, and the index here was NOT moved with it: [7]
    // is the rating cell, which also reads "—", so this passed for a year
    // without looking at the spend cell at all (found while fixing forgejo#82).
    // Indexing cells by number is brittle; it is kept only because this
    // assertion is about the spend cell's CONTENT.
    const spendCell = row?.querySelectorAll("td")[8];
    expect(spendCell?.textContent).toBe("—");
  });

  it("renders — (never 0 €) when the only priced stay is still planned", async () => {
    // forgejo#82: the cell chose its branch from ALL stays but printed the
    // visited-only aggregate. A planned, priced stay passed `hasAnyPrice`,
    // fell through to the converted total, and the row read "0 €" — a hotel
    // not yet slept in, reported as free. The price is not dropped either:
    // it gets its own "planned" line.
    listLodgingsMock.mockResolvedValue([
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
    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    const spendCell = row?.querySelectorAll("td")[8];
    expect(spendCell?.textContent).not.toMatch(/0\s?€/);
    expect(spendCell?.textContent).toMatch(/^—/);
    expect(spendCell?.textContent).toContain("lodging:list.spendPlanned");
  });

  it("surfaces an error state (not a blank page) when the filtered fetch fails", async () => {
    // The baseline call is always `listLodgings({})` — no `sort` key. The
    // reload call that actually feeds the table always includes `sort`.
    // Only the latter fails here, mirroring a real backend 500 on the list
    // query while the dropdown-options fetch still succeeds.
    // Both the baseline and the table fetch fail — only the table fetch
    // drives the alert; the baseline failure merely logs.
    listLodgingsMock.mockRejectedValue(new Error("network failure"));

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
    listLodgingsMock.mockResolvedValue([]);
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
    listLodgingsMock.mockResolvedValue([]);
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
      listLodgingsMock.mockResolvedValue([lodging]);
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
      listLodgingsMock.mockResolvedValue([makeLodging({ id: "l1", name: "Hotel Adlon" })]);
      renderListPage();

      await screen.findByText("Hotel Adlon");
      await userEvent.click(screen.getByTestId("lodging-delete-l1"));

      // The row navigates; without stopPropagation the delete click would
      // also open the very lodging it is about to remove.
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});
