import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Lodging, LodgingStats } from "../../../../types/lodging";

const listLodgingsMock = vi.fn();
const getLodgingStatsMock = vi.fn();

vi.mock("../../../../lib/api/lodging", () => ({
  listLodgings: (...args: unknown[]) => listLodgingsMock(...args),
  getLodgingStats: (...args: unknown[]) => getLodgingStatsMock(...args),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging"],
    isEnabled: (key: string) => key === "lodging",
  }),
}));

vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({
    tab: "lodging",
    mode: "map",
    setTab: vi.fn(),
    setMode: vi.fn(),
  }),
}));

vi.mock("../../../MapContainer3D", () => ({
  default: (props: { lodgingsOverride?: Lodging[]; appearanceDomains?: readonly string[] }) => (
    <div
      data-testid="map-stub"
      data-lodging-count={props.lodgingsOverride?.length ?? 0}
      data-appearance-domains={JSON.stringify(props.appearanceDomains ?? null)}
    />
  ),
}));

// Imported after the mocks above so the module graph picks them up.
import { LodgingTab } from "../LodgingTab";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";

const baseStay = {
  id: "stay-1",
  lodgingId: "lodging-1",
  userId: "user-1",
  tripId: null,
  bookingId: null,
  checkIn: "2024-05-12",
  checkOut: "2024-05-14",
  datePrecision: "DAY" as const,
  nights: null,
  status: "completed" as const,
  roomNumber: null,
  roomCategory: null,
  board: null,
  pricePerNight: null,
  currency: "EUR" as const,
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
};

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
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    stays: [baseStay],
    overallRating: 4.3,
    stayCount: 1,
    nights: 2,
    totalSpendBase: 340,
    totalSpendBaseByCurrency: { EUR: 340 },
    ...overrides,
  };
}

const zeroStats: LodgingStats = {
  lodgingsCount: 0,
  staysCount: 0,
  totalNights: 0,
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 0,
  chainsUnique: 0,
  citiesUnique: 0,
  countries: [],
  countriesCount: 0,
  spendBaseTotal: 0,
  spendByCurrency: {},
  spendUnconvertedStays: 0,
  spendBaseByCurrency: {},
  awardNights: 0,
  nightsByType: {},
  avgRatingOverall: null,
  chainLoyaltyMax: 0,
  sameHotelRepeatMax: 0,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  ...EMPTY_LODGING_STATS_BLOCKS,
};

describe("LodgingTab", () => {
  beforeEach(() => {
    listLodgingsMock.mockReset();
    getLodgingStatsMock.mockReset();
  });

  it("renders the hotel on the map and in the list — but NOT the stat strip", async () => {
    const lodging = makeLodging();
    listLodgingsMock.mockResolvedValue([lodging]);
    getLodgingStatsMock.mockResolvedValue({
      ...zeroStats,
      lodgingsCount: 1,
      staysCount: 1,
      totalNights: 11,
      chainsUnique: 0,
      avgRatingOverall: 4.3,
    });

    render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    expect(screen.getByTestId("map-stub").getAttribute("data-lodging-count")).toBe("1");
    // The nights figure moved to the statistics page. It used to float over the
    // map, where a lifetime total describes nothing the map is showing and
    // covers the part of the world the user opened the map to see.
    expect(screen.queryByText("11")).not.toBeInTheDocument();
  });

  it("passes only the lodging appearanceDomains to MapContainer3D — no flight/cruise appearance controls on the Hotels tab", async () => {
    const lodging = makeLodging();
    listLodgingsMock.mockResolvedValue([lodging]);
    getLodgingStatsMock.mockResolvedValue({
      ...zeroStats,
      lodgingsCount: 1,
      staysCount: 1,
      totalNights: 11,
    });

    render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
    expect(screen.getByTestId("map-stub").getAttribute("data-appearance-domains")).toBe(
      '["lodging"]'
    );
  });

  it("shows an empty state with zero lodgings — no crash, no NaN", async () => {
    listLodgingsMock.mockResolvedValue([]);
    getLodgingStatsMock.mockResolvedValue(zeroStats);

    render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalled();
    });
    expect(screen.getByText("dashboard:lodgingTab.emptyTitle")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByTestId("map-stub").getAttribute("data-lodging-count")).toBe("0");
  });

  it("surfaces a load error without crashing", async () => {
    listLodgingsMock.mockRejectedValue(new Error("network down"));
    getLodgingStatsMock.mockResolvedValue(zeroStats);

    render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:errors.loadLodgings")).toBeInTheDocument();
    });
  });
});

describe("LodgingTab — die Liste merkt sich, ob sie offen war", () => {
  it("öffnet sie beim ersten Mal", async () => {
    listLodgingsMock.mockResolvedValue([makeLodging()]);
    getLodgingStatsMock.mockResolvedValue({ ...zeroStats, lodgingsCount: 1 });
    window.localStorage.clear();

    render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });
  });

  it("hält sie geschlossen, wenn der Nutzer sie geschlossen hat", async () => {
    // Der Kern des gemeldeten Fehlers: der Tab wird bei jedem Bereichswechsel
    // neu montiert, und der alte Anfangswert `true` hat die Entscheidung des
    // Nutzers dabei jedes Mal überschrieben.
    listLodgingsMock.mockResolvedValue([makeLodging()]);
    getLodgingStatsMock.mockResolvedValue({ ...zeroStats, lodgingsCount: 1 });
    window.localStorage.setItem("mapAppearance.v2", JSON.stringify({ lodgingListOpen: false }));

    const { unmount } = render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId("map-stub")).toBeInTheDocument();
    });
    expect(screen.queryByText("Hotel Test Ludwigsburg")).not.toBeInTheDocument();

    // Und auch nach einem erneuten Montieren, denn genau das passiert beim Wechsel.
    unmount();
    render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId("map-stub")).toBeInTheDocument();
    });
    expect(screen.queryByText("Hotel Test Ludwigsburg")).not.toBeInTheDocument();
  });
});
