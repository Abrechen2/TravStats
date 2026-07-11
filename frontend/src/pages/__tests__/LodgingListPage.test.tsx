import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Lodging } from "../../types/lodging";

const listLodgingsMock = vi.fn();

vi.mock("../../lib/api/lodging", () => ({
  listLodgings: (...args: unknown[]) => listLodgingsMock(...args),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/lodging/LodgingFormModal", () => ({
  LodgingFormModal: () => null,
}));

// Use the real settingsStore so we can `setState` a divergent baseCurrency
// vs units.currency, mirroring LodgingDetailPage.test.tsx.
vi.unmock("../../store/settingsStore");

// Imported after the mocks above so the module graph picks them up.
import LodgingListPage from "../LodgingListPage";
import { useSettingsStore } from "../../store/settingsStore";

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
    listLodgingsMock.mockResolvedValue([makeLodging()]);

    renderListPage();

    await waitFor(() => {
      expect(screen.getByText("Hotel Test Ludwigsburg")).toBeInTheDocument();
    });

    const row = screen.getByText("Hotel Test Ludwigsburg").closest("tr");
    expect(row?.textContent).toMatch(/CHF/);
    expect(row?.textContent).not.toMatch(/\$883/);
  });
});
