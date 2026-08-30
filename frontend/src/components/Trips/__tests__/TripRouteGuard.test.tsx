import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TripRouteGuard } from "../TripRouteGuard";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

// NavigationBar pulls in authStore/settingsStore/pendingUpdatesApi and more —
// none of that is what this test is about, so it is stubbed to a marker.
vi.mock("../../NavigationBar", () => ({
  default: () => <div data-testid="nav-bar" />,
}));

const mockUseBetaFeatures = vi.fn();
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => mockUseBetaFeatures(),
}));

function renderGuard(): void {
  render(
    <MemoryRouter initialEntries={["/trips/trip-1/route/route-1"]}>
      <Routes>
        <Route
          path="/trips/:id/route/:routeId"
          element={
            <TripRouteGuard>
              <div data-testid="editor">editor</div>
            </TripRouteGuard>
          }
        />
        <Route path="/trips" element={<div data-testid="trips-list">trips list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("TripRouteGuard", () => {
  // The defect this guards against: a hard load of the editor URL raced the
  // settings fetch and read the not-yet-loaded beta flag as "off", bouncing a
  // valid session to /trips. `betaFeaturesEnabled: null` is that in-flight
  // state — it must render chrome, not redirect.
  it("renders app chrome instead of redirecting while the beta flag is unknown", () => {
    mockUseBetaFeatures.mockReturnValue({
      betaFeaturesEnabled: null,
      isFeatureVisible: () => false,
    });

    renderGuard();

    expect(screen.getByTestId("nav-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByTestId("trips-list")).toBeNull();
  });

  it("redirects to /trips once the flag is definitively false", () => {
    mockUseBetaFeatures.mockReturnValue({
      betaFeaturesEnabled: false,
      isFeatureVisible: () => false,
    });

    renderGuard();

    expect(screen.getByTestId("trips-list")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("renders the editor once the flag is definitively true", () => {
    mockUseBetaFeatures.mockReturnValue({
      betaFeaturesEnabled: true,
      isFeatureVisible: (key: string) => key === "tourRoutes",
    });

    renderGuard();

    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });
});
