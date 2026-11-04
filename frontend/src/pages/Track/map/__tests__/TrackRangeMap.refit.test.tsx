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
vi.mock("../../../../components/map/DeckGLOverlay", () => ({ DeckGLOverlay: () => null }));
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
const props = (over: Partial<TrackRangeMapProps>): TrackRangeMapProps =>
  ({
    frameLines: [LINE],
    lines: [LINE],
    follow: null,
    refit: "leg:a",
    layers: {},
    segments: [],
    points: [],
    anchors: [],
    replay: [],
    photos: [],
    countries: [],
    color: "solid",
    opacity: 1,
    onFogStatus: () => undefined,
    ...over,
  }) as unknown as TrackRangeMapProps;

describe("TrackRangeMap refit", () => {
  it("frames the selected leg again when only the fit padding changes (breakpoint crossed)", async () => {
    const pad = (left: number, bottom: number) => ({ top: 40, right: 24, bottom, left });
    const { rerender } = render(<TrackRangeMap {...props({ fitPadding: pad(356, 40) })} />);
    await act(async () => undefined);
    fit.mockClear();
    rerender(<TrackRangeMap {...props({ fitPadding: pad(356, 40) })} />);
    expect(fit).not.toHaveBeenCalled();
    rerender(<TrackRangeMap {...props({ fitPadding: pad(24, 456) })} />);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0][1]).toMatchObject({ padding: { bottom: 456, left: 24 } });
  });
});
