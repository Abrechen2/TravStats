import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JSX, ReactNode } from "react";
import { render } from "@testing-library/react";

/**
 * A map that cannot save must not offer to be edited.
 *
 * The place detail page showed this map with no-op callbacks, so nothing was
 * ever written — but the marker still carried `draggable`, so it could be
 * picked up and it STAYED where it was dropped. The page then showed a pin in
 * one position and the coordinates underneath in another, until a reload
 * (Alex, 2026-08-29). No data was lost; the screen simply stopped telling the
 * truth.
 *
 * The fix is not a `readOnly` flag somebody has to remember: the callbacks are
 * optional, and their ABSENCE is what makes the map read-only. A caller that
 * cannot handle a move cannot accidentally advertise one.
 */

interface MarkerProps {
  draggable?: boolean;
  children?: ReactNode;
}
interface MapProps {
  onClick?: unknown;
  children?: ReactNode;
}

const markerProps: MarkerProps[] = [];
const mapProps: MapProps[] = [];

vi.mock("react-map-gl/maplibre", () => ({
  __esModule: true,
  default: (props: MapProps): JSX.Element => {
    mapProps.push(props);
    return <div data-testid="mock-map">{props.children}</div>;
  },
  Marker: (props: MarkerProps): JSX.Element => {
    markerProps.push(props);
    return <div data-testid="mock-marker">{props.children}</div>;
  },
}));

const { LocationMiniMap } = await import("../LocationMiniMap");

const base = {
  value: { lat: 41.9009, lon: 12.4833 },
  initialViewState: { longitude: 12.4833, latitude: 41.9009, zoom: 12 },
  focusNonce: 0,
  compact: true,
  ariaLabel: "Karte",
  attributionLabel: "",
};

describe("LocationMiniMap — read-only when it cannot save", () => {
  beforeEach(() => {
    markerProps.length = 0;
    mapProps.length = 0;
  });

  it("does not offer a draggable pin when no drag handler was given", () => {
    render(<LocationMiniMap {...base} />);

    expect(markerProps).toHaveLength(1);
    expect(markerProps[0].draggable).toBeFalsy();
  });

  it("does not accept a click on the map either", () => {
    // Click-to-move is the same promise by another gesture. Leaving it wired
    // would move the pin from a page with no way to save it.
    render(<LocationMiniMap {...base} />);

    expect(mapProps).toHaveLength(1);
    expect(mapProps[0].onClick).toBeUndefined();
  });

  it("still offers both when the caller can handle them", () => {
    render(
      <LocationMiniMap
        {...base}
        onMapClick={(): void => undefined}
        onMarkerDragEnd={(): void => undefined}
      />
    );

    expect(markerProps[0].draggable).toBe(true);
    expect(mapProps[0].onClick).toBeTypeOf("function");
  });
});
