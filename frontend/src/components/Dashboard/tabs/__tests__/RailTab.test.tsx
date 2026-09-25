import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { makeRailJourney } from "../../../rail/__tests__/railJourneyFixture";
import { useDomainColorStore } from "../../../../store/domainColorStore";

/**
 * The dashboard's rail tab (spec 2026-09-25-rail-domain, phase 2b): the key
 * is painted from the domain colour store like the line, names only the kinds
 * of line that are drawn, and nothing is fetched while rail is hidden.
 */
const list = vi.fn();
vi.mock("../../../../lib/api/rail", () => ({
  railApi: { list: (...a: unknown[]) => list(...a) },
}));
vi.mock("../../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const extraLayers = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("../../../MapContainer3D", () => ({
  default: (props: { extraLayers?: unknown[] }) => {
    extraLayers.current = props.extraLayers ?? [];
    return <div data-testid="map-stub" />;
  },
}));
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "rail", mode: "globe", setTab: vi.fn(), setMode: vi.fn() }),
}));
const railVisible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../../hooks/useRailVisible", () => ({ useRailVisible: () => railVisible.value }));

import { RailTab } from "../RailTab";

function renderTab(): void {
  render(
    <MemoryRouter>
      <RailTab />
    </MemoryRouter>
  );
}

describe("RailTab", () => {
  beforeEach(() => {
    list.mockReset();
    railVisible.value = true;
    useDomainColorStore.setState({
      colors: { ...useDomainColorStore.getState().colors, rail: "#112233" },
    });
  });

  it("keys the traced line in the rail colour from the store, and links each ride", async () => {
    list.mockResolvedValue({ journeys: [makeRailJourney()], total: 1 });
    renderTab();
    const legend = await screen.findByTestId("rail-legend");
    expect(legend).toHaveTextContent("dashboard:legend.railTraced");
    expect(legend).not.toHaveTextContent("dashboard:legend.railStraight");
    const swatch = legend.querySelector("span[aria-hidden]") as HTMLElement;
    expect(swatch.style.background).toBe("rgb(17, 34, 51)");
    expect(screen.getByRole("link", { name: "Frankfurt → Fulda" })).toHaveAttribute(
      "href",
      "/rail/j1"
    );
    expect(extraLayers.current.length).toBe(2);
  });

  it("says a failed load instead of drawing an empty map", async () => {
    list.mockRejectedValue(new Error("network"));
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("dashboard:railTab.loadError");
  });

  it("asks for nothing while rail is hidden", async () => {
    railVisible.value = false;
    renderTab();
    await waitFor(() => expect(screen.getByTestId("map-stub")).toBeInTheDocument());
    expect(list).not.toHaveBeenCalled();
  });
});
