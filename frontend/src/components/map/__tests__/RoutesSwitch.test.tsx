import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const route = vi.hoisted(() => ({ tab: "flight", mode: "routes" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../hooks/useDashboardRoute", () => ({ useDashboardRoute: () => route }));

import { RoutesSwitch } from "../RoutesSwitch";
import { useMapRoutesStore } from "../../../store/mapRoutesStore";
import { ALL_ROUTES_VISIBLE } from "../../../lib/mapRoutes";

describe("RoutesSwitch — the panel row", () => {
  beforeEach(() => {
    window.localStorage.clear();
    route.tab = "flight";
    route.mode = "routes";
    useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE } });
  });

  it("is a real switch that turns one domain's lines off and on", () => {
    render(<RoutesSwitch domain="flight" />);
    const sw = screen.getByRole("switch", { name: /map:globe.panel.routes/ });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(useMapRoutesStore.getState().visible).toMatchObject({ flight: false, cruise: true });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(useMapRoutesStore.getState().visible.flight).toBe(true);
  });

  it("is disabled with its reason where the mode is nothing but routes, instead of emptying the map", () => {
    route.mode = "journey";
    render(<RoutesSwitch domain="flight" />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText("map:globe.panel.routesBlocked.journey")).toBeInTheDocument();
  });

  it("is disabled on the day-tour tab, whose map has no marker to leave behind", () => {
    route.tab = "tour";
    render(<RoutesSwitch domain="tour" />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText("map:globe.panel.routesBlocked.tour")).toBeInTheDocument();
  });
});
