import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { Lodging } from "../../types/lodging";
import type { Place } from "../../types/place";
import type { PlaceLabelList } from "../../lib/placeLabel";

/**
 * Measured on main (2026-09-20): MapContainer3D built the `<GlobeView>` call
 * with six props missing that the `<DeckGLMap>` call right beside it passes —
 * `lodgingsOverride`, `placesOverride`, `placeListColors`, `placeListLabels`,
 * `onLodgingClick`, `onPlaceClick` — plus both marker sizes. The consequence
 * was not subtle: `/dashboard/lodging?mode=globe` drew an EMPTY globe while
 * the sidebar beside it listed 31 hotels, and the Alle tab's legend named
 * Unterkünfte and Orte that the globe never drew.
 *
 * Deliberate-break protocol: drop any one of these props from the
 * `<GlobeView>` call in MapContainer3D.tsx and the matching case fails.
 */

const capturedGlobeViewProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const capturedDeckGLMapProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../GlobeView", () => ({
  default: (props: Record<string, unknown>) => {
    capturedGlobeViewProps.push(props);
    return null;
  },
}));

vi.mock("../DeckGLMap", () => ({
  DeckGLMap: (props: Record<string, unknown>) => {
    capturedDeckGLMapProps.push(props);
    return null;
  },
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: [], isEnabled: () => false }),
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

import MapContainer3D from "../MapContainer3D";

const LODGING = { id: "l1", name: "Hotel Kramer", lat: 50.1, lon: 8.6 } as unknown as Lodging;
const PLACE = { id: "p1", name: "Palmengarten", lat: 50.12, lon: 8.65 } as unknown as Place;
const LIST_COLORS = new Map<string, [number, number, number]>([["p1", [12, 34, 56]]]);
const LIST_LABELS = new Map<string, PlaceLabelList>([["p1", { labelMode: "icon", icon: "🌳" }]]);

beforeEach(() => {
  capturedGlobeViewProps.length = 0;
  capturedDeckGLMapProps.length = 0;
});

async function renderGlobe(): Promise<Record<string, unknown>> {
  const onLodgingClick = vi.fn();
  const onPlaceClick = vi.fn();
  render(
    <MapContainer3D
      flights={[]}
      visMode="globe"
      showInternalCruises={false}
      lodgingsOverride={[LODGING]}
      onLodgingClick={onLodgingClick}
      placesOverride={[PLACE]}
      onPlaceClick={onPlaceClick}
      placeListColors={LIST_COLORS}
      placeListLabels={LIST_LABELS}
      appearanceDomains={["flight", "cruise", "lodging", "poi"]}
    />
  );
  await waitFor(() => expect(capturedGlobeViewProps.length).toBeGreaterThan(0));
  return capturedGlobeViewProps[capturedGlobeViewProps.length - 1];
}

describe("MapContainer3D: the lodging and place props reach the globe too", () => {
  it("hands GlobeView the lodgings the flat map would have drawn", async () => {
    const props = await renderGlobe();
    expect(props.lodgings).toEqual([LODGING]);
    expect(typeof props.onLodgingOpen).toBe("function");
  });

  it("hands GlobeView the places, their list colours and their list labels", async () => {
    const props = await renderGlobe();
    expect(props.places).toEqual([PLACE]);
    expect(props.placeListColors).toBe(LIST_COLORS);
    expect(props.placeListLabels).toBe(LIST_LABELS);
    expect(typeof props.onPlaceOpen).toBe("function");
  });

  it("hands GlobeView the two marker sizes it owns, as it already does DeckGLMap", async () => {
    const props = await renderGlobe();
    expect(typeof props.lodgingMarkerSize).toBe("number");
    expect(typeof props.onLodgingMarkerSizeChange).toBe("function");
    expect(typeof props.placeMarkerSize).toBe("number");
    expect(typeof props.onPlaceMarkerSizeChange).toBe("function");
  });

  it("still passes the same lodging/place props to the flat map", () => {
    render(
      <MapContainer3D
        flights={[]}
        visMode="routes"
        showInternalCruises={false}
        lodgingsOverride={[LODGING]}
        placesOverride={[PLACE]}
      />
    );
    const props = capturedDeckGLMapProps[capturedDeckGLMapProps.length - 1];
    expect(props.lodgingsOverride).toEqual([LODGING]);
    expect(props.placesOverride).toEqual([PLACE]);
  });
});
