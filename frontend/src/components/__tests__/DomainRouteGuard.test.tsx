import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.unmock("../../store/settingsStore");

import { DomainRouteGuard } from "../DomainRouteGuard";
import { useSettingsStore } from "../../store/settingsStore";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../NavigationBar", () => ({ default: () => <nav data-testid="nav" /> }));

/**
 * A bookmark must not be answered before the answer is known.
 *
 * `enabledDomains` starts as `["flight"]` in a cold store, and the settings GET
 * fills it in a moment later. A guard with only two states reads that initial
 * value as fact and redirects — so opening a saved cruise or hotel link in a
 * fresh browser bounced to the dashboard while the server said the domain was
 * on. The list pages learned this in 2026-08; the DETAIL routes kept the
 * two-state check until 2026-09-10 (audit finding AUD-015).
 *
 * These cases are about the third state. "Loaded and off" must still redirect —
 * a guard that never says no is not a guard.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/cruises/:id"
          element={
            <DomainRouteGuard domain="cruise">
              <div data-testid="detail">detail</div>
            </DomainRouteGuard>
          }
        />
        <Route path="/" element={<div data-testid="dashboard">dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DomainRouteGuard", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight"], enabledDomainsLoaded: false });
  });

  it("waits instead of redirecting while the domains are still loading", () => {
    renderAt("/cruises/abc");

    expect(screen.queryByTestId("dashboard")).toBeNull();
    expect(screen.queryByTestId("detail")).toBeNull();
    expect(screen.getByText("common:loading.default")).toBeTruthy();
  });

  it("shows the page once the server says the domain is on", () => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise"],
      enabledDomainsLoaded: true,
    });

    renderAt("/cruises/abc");
    expect(screen.getByTestId("detail")).toBeTruthy();
  });

  it("still redirects when the domain is genuinely off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], enabledDomainsLoaded: true });

    renderAt("/cruises/abc");
    expect(screen.getByTestId("dashboard")).toBeTruthy();
  });
});

/**
 * The guard is only worth having where it is actually used.
 *
 * The component above was right the whole time; the defect was that the DETAIL
 * routes never reached it and kept their own two-state check. A test of the
 * component alone would have stayed green through the entire bug, so this one
 * reads the router and insists nobody answers the domain question inline again.
 */
describe("the router asks the guard, not the store", () => {
  const routerSource = readFileSync(join(__dirname, "..", "..", "App.tsx"), "utf8");

  // Idle probe: a source-scanning guard that reads the wrong file, or an empty
  // one, passes forever without ever looking at anything.
  it("is reading the real router", () => {
    expect(routerSource.length).toBeGreaterThan(1000);
    expect(routerSource).toContain("DomainRouteGuard");
    expect(routerSource).toContain('path="/cruises/:id"');
  });

  it("has no route deciding a domain on its own", () => {
    const inline = routerSource.match(/isEnabled\(\s*["'][a-z]+["']\s*\)/g) ?? [];
    expect(inline).toEqual([]);
  });
});
