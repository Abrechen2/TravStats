import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Cruise } from "../../types";

/**
 * The recorded-tracks section of a cruise (2.7) is behind the beta switch
 * (`cruiseTracks` in `config/betaFeatures.ts`): hidden on an instance with the
 * switch off, shown with it on.
 */
const getMock = vi.fn();

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

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

vi.mock("../../components/Cruise/CruiseTracksPanel", () => ({
  default: () => <div data-testid="tracks-panel" />,
}));

let betaOn = false;
vi.mock("../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: betaOn,
    // The real key check, so a typo in the page's gate key fails here too.
    isFeatureVisible: (key: string) => betaOn && key === "cruiseTracks",
  }),
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

describe("CruiseDetailPage recorded tracks gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the recorded tracks while the beta switch is off", async () => {
    betaOn = false;
    await renderCruise(makeCruise());
    expect(screen.queryByTestId("tracks-panel")).toBeNull();
  });

  it("shows them with the beta switch on", async () => {
    betaOn = true;
    await renderCruise(makeCruise());
    expect(screen.getByTestId("tracks-panel")).toBeTruthy();
  });
});
