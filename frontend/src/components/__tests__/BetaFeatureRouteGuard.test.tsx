import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const flag: { value: boolean | null } = { value: null };

vi.mock("../../hooks/useBetaFeatures", () => ({
  useBetaFeatureAccess: () => (flag.value === null ? "pending" : flag.value ? "allowed" : "denied"),
}));

vi.mock("../NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

import { BetaFeatureRouteGuard } from "../BetaFeatureRouteGuard";

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/parser"]}>
      <Routes>
        <Route
          path="/parser"
          element={
            <BetaFeatureRouteGuard feature="parserTemplates" redirectTo="/">
              <div>parser-page</div>
            </BetaFeatureRouteGuard>
          }
        />
        <Route path="/" element={<div>home-marker</div>} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * The three states, and the one-request window that makes a boolean guard
 * wrong: the flag is never persisted, so on a cold load it is null until
 * GET /settings answers. A guard that reads "not known yet" as "no" bounces a
 * bookmark and a refresh — found by driving a browser on /places while every
 * unit test passed, so the rule gets a test wherever it is applied.
 */
describe("BetaFeatureRouteGuard", () => {
  it("shows the chrome and waits while the flag is unknown", () => {
    flag.value = null;
    renderGuard();
    expect(screen.getByTestId("nav-stub")).toBeInTheDocument();
    expect(screen.getByText("common:loading.default")).toBeInTheDocument();
    expect(screen.queryByText("parser-page")).not.toBeInTheDocument();
    expect(screen.queryByText("home-marker")).not.toBeInTheDocument();
  });

  it("redirects when the switch is off", () => {
    flag.value = false;
    renderGuard();
    expect(screen.getByText("home-marker")).toBeInTheDocument();
    expect(screen.queryByText("parser-page")).not.toBeInTheDocument();
  });

  it("renders the page when the switch is on", () => {
    flag.value = true;
    renderGuard();
    expect(screen.getByText("parser-page")).toBeInTheDocument();
  });
});
