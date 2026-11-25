import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, type ReactNode } from "react";

const fit = vi.hoisted(() => vi.fn());
vi.mock("react-map-gl/maplibre", () => ({
  default: forwardRef(function MapStub(
    { children, onLoad }: { children?: ReactNode; onLoad?: () => void },
    ref
  ) {
    useImperativeHandle(ref, () => ({ fitBounds: fit, easeTo: vi.fn() }));
    useEffect(() => onLoad?.(), [onLoad]);
    return <div>{children}</div>;
  }),
}));
const deck = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../../../../components/map/DeckGLOverlay", () => ({
  DeckGLOverlay: ({ layers }: { layers: Array<{ id: string }> }) => {
    deck.ids = layers.map((l) => l.id);
    return null;
  },
}));
vi.mock("../../../../components/map/SharedMapOverlays", () => ({ SharedMapOverlays: () => null }));
vi.mock("../../../../components/map/useBasemapStyle", () => ({ useBasemapStyle: () => "s.json" }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../TrackFogLayer", () => ({ default: () => null }));

import TrackRangeMap, { type TrackRangeMapProps } from "../TrackRangeMap";

const LINE: [number, number][] = [
  [13.4, 52.5],
  [13.41, 52.51],
];

describe("TrackRangeMap hands the map's colour and pick inputs to the layers", () => {
  it("colour by mode reaches the layer list (it was dropped before reaching the map)", async () => {
    const colors = { walk: [1, 2, 3] };
    const props = {
      frameLines: [LINE],
      lines: [LINE],
      follow: null,
      layers: { routes: true },
      segments: [],
      points: [],
      anchors: [],
      replay: [],
      photos: [],
      countries: [],
      color: "mode",
      modePaths: [{ path: LINE, mode: "walk" }],
      modeColors: colors,
      rangeLines: [{ path: LINE, times: [1, 2] }],
      onRangePick: () => undefined,
      opacity: 1,
      onFogStatus: () => undefined,
    } as unknown as TrackRangeMapProps;
    render(<TrackRangeMap {...props} />);
    await act(async () => undefined);
    expect(deck.ids).toContain("track-route-mode");
    expect(deck.ids).toContain("track-range-pick");
  });
});
