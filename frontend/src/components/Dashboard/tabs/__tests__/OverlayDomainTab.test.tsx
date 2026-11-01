import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * forgejo#405: the single-domain dashboard tab of bus, ferry and rental. A
 * failed load is said with a retry (never drawn as an empty domain), an empty
 * domain says so, and nothing is fetched while the domain is switched off.
 */
const busList = vi.fn();
const ferryList = vi.fn();
const rentalList = vi.fn();
vi.mock("../../../../lib/api/bus", () => ({
  busApi: { listAll: (...a: unknown[]) => busList(...a) },
}));
vi.mock("../../../../lib/api/ferry", () => ({
  ferryApi: { listAll: (...a: unknown[]) => ferryList(...a) },
}));
vi.mock("../../../../lib/api/rental", () => ({
  rentalApi: { list: (...a: unknown[]) => rentalList(...a) },
}));
vi.mock("../../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../MapContainer3D", () => ({ default: () => <div data-testid="map-stub" /> }));
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "bus", mode: "globe", setTab: vi.fn(), setMode: vi.fn() }),
}));
const visible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../../hooks/useDomainVisible", () => ({
  useDomainVisible: (): boolean => visible.value,
}));

import { BusTab, FerryTab, RentalTab } from "../OverlayDomainTab";

const wrap = (node: JSX.Element) => render(<MemoryRouter>{node}</MemoryRouter>);

beforeEach(() => {
  busList.mockReset();
  ferryList.mockReset();
  rentalList.mockReset();
  visible.value = true;
});

describe("OverlayDomainTab", () => {
  it("says a failed bus load out loud and retries it, instead of showing an empty domain", async () => {
    busList.mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce([]);
    wrap(<BusTab />);
    expect(await screen.findByRole("alert")).toHaveTextContent("map:loadFailed.buses");
    expect(screen.queryByText("dashboard:overlayTab.bus.empty")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "map:loadFailed.retry" }));
    await waitFor(() => expect(busList).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("dashboard:overlayTab.bus.empty")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a failed ferry load out loud", async () => {
    ferryList.mockRejectedValue(new Error("500"));
    wrap(<FerryTab />);
    expect(await screen.findByRole("alert")).toHaveTextContent("map:loadFailed.ferries");
  });

  it("says a failed rental load out loud and names an empty one", async () => {
    rentalList.mockRejectedValueOnce(new Error("500"));
    wrap(<RentalTab />);
    expect(await screen.findByRole("alert")).toHaveTextContent("map:loadFailed.rentals");
  });

  it("names a domain with nothing logged", async () => {
    rentalList.mockResolvedValue({ rentals: [], total: 0 });
    wrap(<RentalTab />);
    expect(await screen.findByText("dashboard:overlayTab.rental.empty")).toBeInTheDocument();
  });

  it("fetches nothing while the domain is switched off", async () => {
    visible.value = false;
    wrap(<FerryTab />);
    await waitFor(() => expect(screen.getByTestId("ferry-tab")).toBeInTheDocument());
    expect(ferryList).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
