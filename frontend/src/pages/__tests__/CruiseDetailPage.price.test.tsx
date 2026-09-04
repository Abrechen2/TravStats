import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Cruise } from "../../types";

/**
 * forgejo#86 — the same amount was written three ways across the app. The
 * cruise page glued `toFixed(2)` to the raw code ("40206.00 EUR") while the
 * trip card beside it wrote "40.206 €". One formatter (`lib/units.ts`) now
 * answers for every money figure; this pins the cruise page to it.
 */
const getMock = vi.fn();

vi.mock("../../lib/api", () => ({
  cruiseApi: {
    get: (...args: unknown[]) => getMock(...args),
    remove: vi.fn(),
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de" },
  }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/Cruise/CruiseRouteMap", () => ({
  CruiseRouteMap: () => <div data-testid="map-stub" />,
}));

vi.mock("../../components/Cruise/CruiseEditModal", () => ({
  CruiseEditModal: () => null,
}));

import CruiseDetailPage from "../CruiseDetailPage";

function makeCruise(overrides: Partial<Cruise> = {}): Cruise {
  return {
    id: "cruise-1",
    userId: "user-1",
    shipId: null,
    ship: null,
    shipNameOverride: "AIDAnova",
    cruiseLine: "AIDA",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2024-05-13T00:00:00.000Z",
    endDate: "2024-05-20T00:00:00.000Z",
    status: "flown",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: 40206,
    currency: "EUR",
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function renderCruise(cruise: Cruise): Promise<void> {
  getMock.mockResolvedValue(cruise);
  render(
    <MemoryRouter initialEntries={[`/cruises/${cruise.id}`]}>
      <Routes>
        <Route path="/cruises/:id" element={<CruiseDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText("AIDAnova");
}

describe("CruiseDetailPage price", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats the price through formatCurrency, not '40206.00 EUR'", async () => {
    await renderCruise(makeCruise({ price: 40206, currency: "EUR" }));

    const label = screen.getByText("field.price");
    const row = label.closest("div");
    expect(row?.textContent).toMatch(/40\.206\s€/);
    expect(row?.textContent).not.toContain("40206.00 EUR");
  });

  it("writes a price with no currency as a bare number, never as EUR", async () => {
    await renderCruise(makeCruise({ price: 1234.5, currency: null }));

    const row = screen.getByText("field.price").closest("div");
    expect(row?.textContent).toMatch(/1\.234,5/);
    expect(row?.textContent).not.toMatch(/EUR|€/);
  });
});
