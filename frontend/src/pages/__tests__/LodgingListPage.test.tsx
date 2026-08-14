import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Lodging, LodgingStats, LodgingStay } from "../../types/lodging";

const listLodgingsMock = vi.fn();
const getLodgingStatsMock = vi.fn();

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
  spendBaseTotal: 883,
  spendByCurrency: { EUR: 883 },
  spendUnconvertedStays: 0,
  spendBaseByCurrency: { EUR: 883 },
  awardNights: 0,
  nightsByType: { hotel: 2 },
  avgRatingOverall: null,
  chainLoyaltyMax: 0,
  sameHotelRepeatMax: 1,
};

vi.mock("../../lib/api/lodging", () => ({
  listLodgings: (...args: unknown[]) => listLodgingsMock(...args),
  getLodgingStats: () => getLodgingStatsMock(),
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
    checkIn: "2024-01-01T00:00:00.000Z",
    checkOut: "2024-01-02T00:00:00.000Z",
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
    lat: 48.9,
    lon: 9.19,
    stars: 4,
    amenities: [],
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
      units: { distanceUnit: "kilometers", currency: "EUR" },
    });
  });

  it("labels totalSpendBase with the real baseCurrency, not a differing units.currency", async () => {
    // totalSpendBase is a base-currency figure (CHF here) computed by the
    // backend. Units→Currency is a separate, independently-set display
    // preference (USD here) used elsewhere for flight costs — it must not
    // leak into this column.
    useSettingsStore.setState({
      baseCurrency: "CHF",
      units: { distanceUnit: "kilometers", currency: "USD" },
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

    await user.selectOptions(screen.getByLabelText("lodging:filter.type"), "campsite");
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite", sort: "name" })
      );
    });

    listLodgingsMock.mockClear();
    await user.selectOptions(screen.getByLabelText("lodging:filter.year"), "2023");
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite", year: 2023, sort: "name" })
      );
    });

    listLodgingsMock.mockClear();
    await user.selectOptions(screen.getByLabelText("lodging:filter.country"), "US");
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "campsite", year: 2023, country: "US", sort: "name" })
      );
    });

    listLodgingsMock.mockClear();
    await user.selectOptions(screen.getByLabelText("lodging:filter.sort"), "spend");
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "campsite",
          year: 2023,
          country: "US",
          sort: "spend",
        })
      );
    });
  });

  it("renders rows in exactly the order the API returned them — never re-sorted client-side", async () => {
    // The backend sorts the full set THEN paginates; a local re-sort of an
    // already-ordered response would silently produce a wrong order. This
    // order is deliberately NOT alphabetical and NOT sorted by nights/spend,
    // so a client-side re-sort bug (by any of those keys) would be caught.
    const ordered: Lodging[] = [
      makeLodging({ id: "l-1", name: "Zebra Lodge", nights: 1, totalSpendBase: 500 }),
      makeLodging({ id: "l-2", name: "Alpha Inn", nights: 9, totalSpendBase: 10 }),
      makeLodging({ id: "l-3", name: "Mid Motel", nights: 4, totalSpendBase: 250 }),
    ];
    listLodgingsMock.mockResolvedValue(ordered);

    const { container } = renderListPage();

    await waitFor(() => {
      expect(container.querySelectorAll("tbody tr").length).toBe(3);
    });

    const rowNames = Array.from(container.querySelectorAll("tbody tr")).map(
      (row) => row.querySelector("td")?.textContent ?? ""
    );
    expect(rowNames[0]).toContain("Zebra Lodge");
    expect(rowNames[1]).toContain("Alpha Inn");
    expect(rowNames[2]).toContain("Mid Motel");
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
    const spendCell = row?.querySelectorAll("td")[6];
    expect(spendCell?.textContent).toBe("—");
  });

  it("surfaces an error state (not a blank page) when the filtered fetch fails", async () => {
    // The baseline call is always `listLodgings({})` — no `sort` key. The
    // reload call that actually feeds the table always includes `sort`.
    // Only the latter fails here, mirroring a real backend 500 on the list
    // query while the dropdown-options fetch still succeeds.
    listLodgingsMock.mockImplementation((query: Record<string, unknown>) => {
      if ("sort" in query) return Promise.reject(new Error("network failure"));
      return Promise.resolve([]);
    });

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
    expect(hubLink).toHaveAttribute("href", "/settings?section=import");
    expect(screen.queryByText("lodging:import.csv.title")).not.toBeInTheDocument();
  });

  // Two buttons that both read "…importieren" sat side by side after the tile
  // moved out — the same indistinguishable-labels problem reported in Discord
  // on 2026-08-03. The email/PDF trigger must not echo the hub link.
  it("gives the single-booking import trigger a label distinct from the hub link", async () => {
    listLodgingsMock.mockResolvedValue([]);
    renderListPage();

    expect(
      await screen.findByRole("button", { name: /import:lodging\.triggerLabel/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /import:lodging\.panelTitle/ })
    ).not.toBeInTheDocument();
  });
});
