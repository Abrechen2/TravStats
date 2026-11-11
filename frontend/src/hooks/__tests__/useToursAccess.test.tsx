import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { useToursAccess } from "../useToursVisible";
import { DomainRouteGuard } from "../../components/DomainRouteGuard";
import { useNavItems } from "../../components/Nav/useNavItems";
import { useSettingsStore } from "../../store/settingsStore";
import { useRemoteSettingsStatus } from "../../store/remoteSettingsStatus";

vi.mock("../useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <nav /> }));
vi.mock("../useTravPlanVisible", () => ({ useTravPlanVisible: () => false }));
vi.mock("../useTravTrackVisible", () => ({ useTravTrackVisible: () => false }));

function setup(opts: { domains: string[]; beta: boolean | null; loaded?: boolean }): void {
  useSettingsStore.setState({
    enabledDomains: opts.domains as never,
    enabledDomainsLoaded: opts.loaded ?? true,
    betaFeaturesEnabled: opts.beta,
  });
}

beforeEach(() => {
  useRemoteSettingsStatus.setState({ failed: false });
});

describe("tours access: the domain switch AND the roadtrips beta key", () => {
  it("is allowed only when both are open", () => {
    setup({ domains: ["flight", "tour"], beta: true });
    expect(renderHook(() => useToursAccess()).result.current).toBe("allowed");
  });

  it("is denied when the user switched tours off, however the beta key stands", () => {
    setup({ domains: ["flight"], beta: true });
    expect(renderHook(() => useToursAccess()).result.current).toBe("denied");
  });

  it("is denied when the beta key is closed, even with the domain switched on", () => {
    setup({ domains: ["flight", "tour"], beta: false });
    expect(renderHook(() => useToursAccess()).result.current).toBe("denied");
  });

  it("is pending, not denied, while the instance flag is unknown", () => {
    setup({ domains: ["flight"], beta: null });
    expect(renderHook(() => useToursAccess()).result.current).toBe("pending");
  });

  it("is pending, not denied, while the user's settings have not loaded", () => {
    setup({ domains: ["flight"], beta: true, loaded: false });
    expect(renderHook(() => useToursAccess()).result.current).toBe("pending");
  });
});

describe("the /tours route guard", () => {
  function renderGuard(): void {
    render(
      <MemoryRouter initialEntries={["/tours"]}>
        <Routes>
          <Route
            path="/tours"
            element={
              <DomainRouteGuard domain="tour">
                <div data-testid="tours-page" />
              </DomainRouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it("shows the page with the domain on and the beta key open", () => {
    setup({ domains: ["flight", "tour"], beta: true });
    renderGuard();
    expect(screen.getByTestId("tours-page")).toBeInTheDocument();
  });

  it("hides the page when the tour domain is off", () => {
    setup({ domains: ["flight"], beta: true });
    renderGuard();
    expect(screen.queryByTestId("tours-page")).not.toBeInTheDocument();
  });

  it("hides the page when the roadtrips beta key is off, though the domain is on", () => {
    setup({ domains: ["flight", "tour"], beta: false });
    renderGuard();
    expect(screen.queryByTestId("tours-page")).not.toBeInTheDocument();
  });
});

describe("the navigation entry for tours", () => {
  function navPaths(): string[] {
    const { result } = renderHook(() => useNavItems(), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });
    const leaves = result.current.primary.flatMap((n) => (n.kind === "group" ? n.children : [n]));
    return leaves.map((l) => l.path);
  }

  it("lists /tours when the domain is on and the beta key is open", () => {
    setup({ domains: ["flight", "tour"], beta: true });
    expect(navPaths()).toContain("/tours");
  });

  it("hides /tours when the domain is off", () => {
    setup({ domains: ["flight", "cruise"], beta: true });
    expect(navPaths()).not.toContain("/tours");
  });

  it("hides /tours when the beta key is off", () => {
    setup({ domains: ["flight", "tour"], beta: false });
    expect(navPaths()).not.toContain("/tours");
  });
});

describe("App routing of the tour pages", () => {
  // The guard components are tested above; this pins that the routes use them
  // (App is too heavy to mount) — both tour paths were beta-only before T2.
  const app = readFileSync(join(__dirname, "../../App.tsx"), "utf8");

  it.each(['path="/tours"', 'path="/tours/:routeId"', 'path="/trips/:id/route/:routeId"'])(
    "guards %s with the tour domain",
    (path) => {
      const at = app.indexOf(path);
      expect(at).toBeGreaterThan(-1);
      const block = app.slice(at, at + 600);
      expect(block).toContain('<DomainRouteGuard domain="tour">');
    }
  );
});
