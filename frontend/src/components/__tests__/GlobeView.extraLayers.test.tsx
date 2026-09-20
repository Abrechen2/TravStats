import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import * as React from "react";
import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";

/**
 * H1 (fix round 1 review, 2026-08-30): GlobeView never accepted extra
 * deck.gl layers, so anything drawn via MapContainer3D's `extraLayers`
 * prop (dashboard-wide tour paths, journey-mode layers) silently vanished
 * in globe mode -- the globe rendered with nothing on it while a legend
 * built from the same data kept claiming otherwise.
 *
 * This test mounts the REAL GlobeView (not a mock) and proves that a
 * layer passed via its new `extraLayers` prop reaches the deck.gl overlay
 * MapboxOverlay is constructed with -- i.e. the exact object the globe's
 * WebGL canvas draws from. Everything else GlobeView depends on
 * (MapLibre's own map instance, the deck.gl/mapbox interleaving, and the
 * chrome components that aren't relevant to this bug) is stubbed, since
 * none of it can run under jsdom (no WebGL) and none of it is what this
 * bug is about.
 *
 * Deliberate-break protocol: comment out `extraLayers` in either the
 * `GlobeViewProps` destructuring default or the final `[...built,
 * ...extraLayers]` spread in GlobeView.tsx, or drop `extraLayers=
 * {extraLayers}` from MapContainer3D.tsx's `<GlobeView>` call (a separate
 * test below covers that half) -- this test fails either way.
 */

const { capturedOverlayProps, mapGlOnLoadRef } = vi.hoisted(() => ({
  capturedOverlayProps: [] as Array<{ layers: Layer[] }>,
  mapGlOnLoadRef: { current: null as (() => void) | null },
}));

// A fake MapLibre map instance -- just enough surface for the effects
// GlobeView runs once `mapReady` flips true. None of these calls are
// under test; they only need to not throw.
function makeFakeMaplibreMap(): Record<string, unknown> {
  return {
    setProjection: vi.fn(),
    setSky: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 2),
    getBearing: vi.fn(() => 0),
    getPitch: vi.fn(() => 0),
    getCanvas: vi.fn(() => ({ style: {} })),
    getContainer: vi.fn(() => document.createElement("div")),
    jumpTo: vi.fn(),
  };
}

vi.mock("react-map-gl/maplibre", () => {
  const fakeMap = makeFakeMaplibreMap();

  // Mimics react-map-gl's real contract closely enough for GlobeView's
  // needs: forwards `ref.current = { getMap: () => fakeMap }` on mount,
  // fires `onLoad` once mounted (the event GlobeView's own `onMapLoad`
  // is gated on), and renders `children` (the DeckGLOverlay control).
  const MockMapGL = React.forwardRef(function MockMapGL(
    props: { onLoad?: () => void; children?: React.ReactNode },
    ref: React.Ref<unknown>
  ) {
    React.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }), []);
    React.useEffect(() => {
      mapGlOnLoadRef.current = props.onLoad ?? null;
      props.onLoad?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement("div", { "data-testid": "fake-maplibre-map" }, props.children);
  });

  // Mirrors react-map-gl's real useControl closely enough: the factory
  // runs once per component instance and the resulting control instance
  // is stable across re-renders (GlobeView's DeckGLOverlay relies on this
  // -- it calls `overlay.setProps(...)` on every render rather than
  // re-constructing the overlay).
  function useControl<T>(factory: () => T): T {
    const ref = React.useRef<T | null>(null);
    if (ref.current === null) ref.current = factory();
    return ref.current;
  }

  return { __esModule: true, default: MockMapGL, useControl };
});

vi.mock("@deck.gl/mapbox", () => {
  class MockMapboxOverlay {
    props: { layers: Layer[] };
    constructor(props: { layers: Layer[] }) {
      this.props = props;
      capturedOverlayProps.push(this.props);
    }
    setProps(next: { layers: Layer[] }): void {
      this.props = next;
      capturedOverlayProps.push(next);
    }
  }
  return { MapboxOverlay: MockMapboxOverlay };
});

// Chrome/UI components irrelevant to this bug -- stubbed so mounting
// GlobeView doesn't require driving their own (unrelated) prop contracts.
vi.mock("../Globe/GlobeControlPanel", () => ({
  GlobeControlPanel: () => null,
}));
vi.mock("../Globe/GlobeTimeHistogram", () => ({
  GlobeTimeHistogram: () => null,
}));
vi.mock("../map/cards/HoverTooltip", () => ({
  HoverTooltip: React.forwardRef(function MockHoverTooltip(
    _props: unknown,
    ref: React.Ref<unknown>
  ) {
    React.useImperativeHandle(ref, () => ({ show: vi.fn(), hide: vi.fn() }), []);
    return null;
  }),
}));
vi.mock("../map/cards/PinnedCard", () => ({ PinnedCard: () => null }));
vi.mock("../map/cards/PinnedCardBoundary", () => ({
  PinnedCardBoundary: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("../Globe/GlobeLabelsOverlay", () => ({ GlobeLabelsOverlay: () => null }));
// Mutates the real MapLibre map via setTerrain/setLayoutProperty -- not
// relevant to this bug, and the fake map above doesn't implement them.
vi.mock("../Globe/mapOverlays", () => ({ applyMapOverlays: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

// Imported after the mocks above so the module graph picks them up.
import GlobeView from "../GlobeView";

// A REAL layer, not a stand-in object: since `occludeExtraLayers` the globe
// clones what a caller passes to give it the earth-occlusion extension, and a
// bare `{id}` has neither `props` nor `clone` — it would measure the guard
// rather than the wiring.
const EXTRA_LAYER: Layer = new PathLayer({ id: "dashboard-tour-paths-test", data: [] });

beforeEach(() => {
  capturedOverlayProps.length = 0;
  mapGlOnLoadRef.current = null;
  window.localStorage.clear();
});

describe("GlobeView: extraLayers reach the deck.gl overlay", () => {
  it("includes a passed extraLayers entry in what MapboxOverlay is given", async () => {
    render(<GlobeView flights={[]} cruises={[]} extraLayers={[EXTRA_LAYER]} />);

    await waitFor(() => expect(capturedOverlayProps.length).toBeGreaterThan(0));
    const lastLayers = capturedOverlayProps[capturedOverlayProps.length - 1].layers;
    // By ID, not by identity: since `occludeExtraLayers` the caller's layer
    // arrives CLONED, carrying the earth-occlusion extension every
    // globe-built layer has. deck.gl diffs layers by id, so it is still the
    // same layer as far as the overlay is concerned.
    expect(lastLayers.map((l) => l.id)).toContain(EXTRA_LAYER.id);
  });

  it("renders with no extra layers at all when none are passed (default stays [])", async () => {
    render(<GlobeView flights={[]} cruises={[]} />);

    await waitFor(() => expect(capturedOverlayProps.length).toBeGreaterThan(0));
    const lastLayers = capturedOverlayProps[capturedOverlayProps.length - 1].layers;
    expect(lastLayers.map((l) => l.id)).not.toContain(EXTRA_LAYER.id);
  });
});
