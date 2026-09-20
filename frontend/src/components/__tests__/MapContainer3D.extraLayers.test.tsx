import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";

/**
 * H1 (fix round 1 review, 2026-08-30): MapContainer3D forwarded
 * `extraLayers` into DeckGLMap only -- GlobeView had no such prop, so
 * anything drawn via `extraLayers` (dashboard-wide tour paths,
 * journey-mode layers) silently vanished the moment a caller's `visMode`
 * was "globe". `GlobeView.extraLayers.test.tsx` proves GlobeView's own
 * half (it now accepts and merges the prop); this test proves the OTHER
 * half named in the review -- that MapContainer3D actually forwards
 * `extraLayers` into BOTH children, not just DeckGLMap.
 *
 * Deliberate-break protocol: remove `extraLayers={extraLayers}` from
 * either the `<DeckGLMap>` or the `<GlobeView>` call in
 * MapContainer3D.tsx -- this test fails either way.
 */

const capturedDeckGLMapProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const capturedGlobeViewProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../DeckGLMap", () => ({
  DeckGLMap: (props: Record<string, unknown>) => {
    capturedDeckGLMapProps.push(props);
    return null;
  },
}));

vi.mock("../GlobeView", () => ({
  default: (props: Record<string, unknown>) => {
    capturedGlobeViewProps.push(props);
    return null;
  },
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: [], isEnabled: () => false }),
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

// Imported after the mocks above so the module graph picks them up.
import MapContainer3D from "../MapContainer3D";

const EXTRA_LAYER = { id: "test-extra-layer" } as unknown as Layer;

beforeEach(() => {
  capturedDeckGLMapProps.length = 0;
  capturedGlobeViewProps.length = 0;
});

describe("MapContainer3D: extraLayers reaches both map engines", () => {
  it("forwards extraLayers to DeckGLMap in a non-globe visMode", () => {
    render(
      <MapContainer3D
        flights={[]}
        visMode="routes"
        extraLayers={[EXTRA_LAYER]}
        showInternalCruises={false}
      />
    );

    expect(capturedDeckGLMapProps.length).toBeGreaterThan(0);
    expect(capturedDeckGLMapProps[capturedDeckGLMapProps.length - 1].extraLayers).toEqual([
      EXTRA_LAYER,
    ]);
  });

  it("forwards extraLayers to GlobeView when visMode is globe", async () => {
    render(
      <MapContainer3D
        flights={[]}
        visMode="globe"
        extraLayers={[EXTRA_LAYER]}
        showInternalCruises={false}
      />
    );

    await waitFor(() => expect(capturedGlobeViewProps.length).toBeGreaterThan(0));
    expect(capturedGlobeViewProps[capturedGlobeViewProps.length - 1].extraLayers).toEqual([
      EXTRA_LAYER,
    ]);
    // Only GlobeView should be mounted in globe mode -- DeckGLMap must not
    // ALSO render underneath it.
    expect(capturedDeckGLMapProps.length).toBe(0);
  });

  /**
   * `showInternalCruises={false}` means "this tab draws its own cruises, do
   * not draw them for it". DeckGLMap honoured it; GlobeView was handed the
   * whole list regardless, because nothing rendered a caller's own layers
   * there until `extraLayers` was wired. Now the journey view CAN open on the
   * globe (owner ruling 2026-09-20), and without this the globe would draw
   * every visible cruise on top of the one trip the view is about.
   */
  it("keeps the internal cruise layer off the globe when the caller owns it", async () => {
    const cruise = { id: "c1", stops: [] } as never;
    render(
      <MapContainer3D
        flights={[]}
        visMode="globe"
        extraLayers={[EXTRA_LAYER]}
        showInternalCruises={false}
        cruisesOverride={[cruise]}
      />
    );

    await waitFor(() => expect(capturedGlobeViewProps.length).toBeGreaterThan(0));
    expect(capturedGlobeViewProps[capturedGlobeViewProps.length - 1].cruises).toEqual([]);
  });

  it("still hands the globe its cruises when nobody else is drawing them", async () => {
    const cruise = { id: "c1", stops: [] } as never;
    render(<MapContainer3D flights={[]} visMode="globe" cruisesOverride={[cruise]} />);

    await waitFor(() => expect(capturedGlobeViewProps.length).toBeGreaterThan(0));
    expect(capturedGlobeViewProps[capturedGlobeViewProps.length - 1].cruises).toEqual([cruise]);
  });
});
