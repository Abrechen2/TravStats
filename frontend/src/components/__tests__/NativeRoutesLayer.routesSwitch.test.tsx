import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-map-gl/maplibre", () => ({
  Source: ({ id, children }: { id: string; children?: React.ReactNode }) => (
    <div data-testid={`source-${id}`}>{children}</div>
  ),
  Layer: ({ id }: { id: string }) => <div data-testid={`layer-${id}`} />,
}));

import { NativeRoutesLayer } from "../NativeRoutesLayer";
import { useMapRoutesStore } from "../../store/mapRoutesStore";
import { ALL_ROUTES_VISIBLE } from "../../lib/mapRoutes";

describe("NativeRoutesLayer (no-WebGL fallback) honours the Routen switch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE }, blocked: false });
  });

  it("draws the line layer while flight routes are on", () => {
    render(<NativeRoutesLayer flights={[]} minRouteCount={1} selectedIds={[]} />);
    expect(screen.getByTestId("layer-native-routes-line")).toBeInTheDocument();
  });

  it("drops the line layer but keeps the airports when flight routes are off", () => {
    useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE, flight: false } });
    render(<NativeRoutesLayer flights={[]} minRouteCount={1} selectedIds={[]} />);
    expect(screen.queryByTestId("layer-native-routes-line")).not.toBeInTheDocument();
    expect(screen.getByTestId("layer-native-airports-circle")).toBeInTheDocument();
  });
});
