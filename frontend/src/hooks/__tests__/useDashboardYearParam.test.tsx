import { describe, expect, it, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";

import { useDashboardYearParam } from "../useDashboardYearParam";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";
import { dashboardYearHref } from "../../lib/stats/yearLinks";

function Probe(): JSX.Element {
  useDashboardYearParam();
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
    </MemoryRouter>
  );

describe("the dashboard's ?year= param", () => {
  beforeEach(() => useDashboardFilterStore.getState().reset());

  it("the statistics page's Karte link sets the year filter and its time range", () => {
    renderAt(dashboardYearHref(2024));
    const s = useDashboardFilterStore.getState();
    expect(s.year).toBe(2024);
    expect(s.time).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });

  it("ignores a year that is not one", () => {
    renderAt("/dashboard?year=banana");
    expect(useDashboardFilterStore.getState().year).toBeNull();
  });

  it("choosing a year writes it to the URL; choosing all years removes it", () => {
    const view = renderAt("/dashboard?mode=routes");
    act(() => useDashboardFilterStore.getState().setYear(2023));
    expect(view.getByTestId("search").textContent).toContain("year=2023");
    expect(view.getByTestId("search").textContent).toContain("mode=routes");
    act(() => useDashboardFilterStore.getState().setYear(null));
    expect(view.getByTestId("search").textContent).not.toContain("year=");
  });

  it("a link to a year keeps it in the URL (the filter does not wipe it on mount)", () => {
    const view = renderAt("/dashboard?year=2024");
    expect(view.getByTestId("search").textContent).toBe("?year=2024");
  });
});
