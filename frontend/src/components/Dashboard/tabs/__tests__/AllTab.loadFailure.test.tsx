import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useDashboardTours", () => ({
  useDashboardTours: () => ({
    tours: [],
    toursLoading: false,
    toursLoadError: null,
    geometries: [],
    reload: () => {},
  }),
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { domains?: string }) => (o?.domains ? `${k}|${o.domains}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../MapContainer3D", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../../../lib/api/lodging", () => ({ listLodgings: () => Promise.resolve([]) }));
vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "all", mode: "overview", setTab: () => {}, setMode: () => {} }),
}));
vi.mock("../../../../hooks/useFlightLookup", () => ({
  useFlightLookup: () => ({ lookup: () => null, lookupMany: () => [] }),
}));
vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: { getAllGeoJSON: vi.fn().mockRejectedValue(new Error("503")) },
}));
vi.mock("../../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockRejectedValue(new Error("503")) },
}));
vi.mock("../../../../lib/api/places", () => ({ listPlaces: () => Promise.resolve([]) }));
vi.mock("../../../../lib/api/placeLists", () => ({ listPlaceLists: () => Promise.resolve([]) }));
vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

import { AllTab } from "../AllTab";

describe("AllTab: a domain that failed to load is named (forgejo#371)", () => {
  it("shows a status line for the failed flights and cruises instead of silently dropping them", async () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/tabStrip\.tabs\.flight/);
    expect(alert).toHaveTextContent(/tabStrip\.tabs\.cruise/);
    expect(alert).not.toHaveTextContent(/tabStrip\.tabs\.lodging/);
  });
});
