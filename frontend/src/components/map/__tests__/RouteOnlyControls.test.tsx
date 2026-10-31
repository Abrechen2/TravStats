import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { RouteOnlyControls } from "../RouteOnlyControls";
import { CollapsibleSection, usePanelExpanded } from "../controlPanelKit";
import { useMapRoutesStore } from "../../../store/mapRoutesStore";
import { ALL_ROUTES_VISIBLE } from "../../../lib/mapRoutes";

describe("RouteOnlyControls — line-only controls while routes are off", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE }, blocked: false });
  });

  it("leaves the controls live while the domain's routes are on", () => {
    render(
      <RouteOnlyControls domain="flight">
        <input type="range" aria-label="width" />
      </RouteOnlyControls>
    );
    expect(screen.getByLabelText("width")).toBeEnabled();
    expect(screen.queryByTestId("route-only-reason-flight")).not.toBeInTheDocument();
  });

  it("disables them with the reason when that domain's routes are off, and only that domain's", () => {
    useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE, flight: false } });
    render(
      <>
        <RouteOnlyControls domain="flight">
          <input type="range" aria-label="flight width" />
        </RouteOnlyControls>
        <RouteOnlyControls domain="cruise">
          <input type="range" aria-label="cruise width" />
        </RouteOnlyControls>
      </>
    );
    expect(screen.getByLabelText("flight width")).toBeDisabled();
    expect(screen.getByText("map:globe.panel.routeControlsOff")).toBeInTheDocument();
    expect(screen.getByLabelText("cruise width")).toBeEnabled();
  });
});

describe("map panel deep link (?panel=routes from Settings › Ansichten)", () => {
  function Probe(): JSX.Element {
    const [expanded] = usePanelExpanded();
    return (
      <div>
        <span data-testid="panel">{expanded ? "open" : "shut"}</span>
        <CollapsibleSection id="flight" title="Flüge">
          <span>flight-body</span>
        </CollapsibleSection>
        <CollapsibleSection id="lodging" title="Unterkünfte">
          <span>lodging-body</span>
        </CollapsibleSection>
      </div>
    );
  }
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.history.pushState({}, "", "/"));

  it("stays shut without the parameter", () => {
    render(<Probe />);
    expect(screen.getByTestId("panel")).toHaveTextContent("shut");
    expect(screen.queryByText("flight-body")).not.toBeInTheDocument();
  });

  it("opens the panel and the route-domain sections, not the others", () => {
    window.history.pushState({}, "", "/dashboard?panel=routes");
    render(<Probe />);
    expect(screen.getByTestId("panel")).toHaveTextContent("open");
    expect(screen.getByText("flight-body")).toBeInTheDocument();
    expect(screen.queryByText("lodging-body")).not.toBeInTheDocument();
  });
});
