import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PinnedCard } from "../PinnedCard";
import {
  buildNativeGlobe,
  type NativeGlobeInput,
  type NativeGlobeSpec,
} from "../../../Globe/native/nativeGlobeLayers";
import { pinnedFromHit, resolveNativeHit } from "../../../Globe/native/nativeGlobeHits";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";
import { DEFAULT_LODGING_COLOR_CONFIG } from "../../../../lib/lodgingColor";
import { DEFAULT_PLACE_COLOR_CONFIG } from "../../../../lib/placeColor";
import type { GlobePinned } from "../../../Globe/globeLayerTypes";
import type { Lodging } from "../../../../types/lodging";
import type { Place } from "../../../../types/place";

/**
 * Moved here with the card on 2026-09-20: it is shared map chrome now, not
 * globe chrome, so its tests live beside it. The globe-layer half of this file
 * (the pin click) still reaches back into `Globe/`, which is correct — that
 * half IS globe-specific.
 *
 * Clicking a hotel or a place on the globe has to answer with the same card
 * an airport or a port answers with — and with a way OUT of it, to the entry
 * itself. Two things are pinned here: that the click produces the pinned
 * state at all, and that the card it produces carries the open CTA.
 *
 * Why the click does not simply call the caller's handler, the way the flat
 * map's pin does: the Alle tab's place handler navigates to /places/:id, so
 * firing it on click would leave the globe before the card could be read.
 * The card's CTA is where that handler belongs — the same trade the flight
 * arc's "open last flight" already makes.
 */

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "count" in opts ? `${key}:${String(opts.count)}` : key,
    i18n: { language: "de", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

const LODGING = {
  id: "l1",
  name: "Hotel Kramer",
  type: "hotel",
  lat: 50.1,
  lon: 8.6,
  city: "Frankfurt",
  country: "DE",
  stayCount: 3,
  nights: 7,
  chain: { id: 2, name: "Kempinski" },
  overallRating: 4.3,
} as unknown as Lodging;

const PLACE = {
  id: "p1",
  name: "Palmengarten",
  category: "nature",
  lat: 50.12,
  lon: 8.65,
  city: "Frankfurt",
  country: "DE",
  visited: true,
  visitCount: 2,
  lastVisitAt: null,
} as unknown as Place;

const WISHLIST = { ...PLACE, id: "p2", visited: false, visitCount: 0 } as Place;

function nativeSpec(over: Partial<NativeGlobeInput>): NativeGlobeSpec {
  return buildNativeGlobe({
    nightCells: [],
    showNight: false,
    cruisePaths: [],
    cruiseWidthScale: 1,
    airportPoints: [],
    airportColor: [1, 1, 1],
    airportRadius: 5,
    portPoints: [],
    portColor: [2, 2, 2],
    portRadius: 5,
    lodgings: [],
    lodgingColors: DEFAULT_LODGING_COLOR_CONFIG,
    lodgingRadius: 5,
    places: [],
    placeColors: DEFAULT_PLACE_COLOR_CONFIG,
    placeRadius: 5,
    extraLayers: [],
    routesVisible: ALL_ROUTES_VISIBLE,
    lite: false,
    ...over,
  });
}

/** What a click on feature `index` of the layer pins — the path a map click takes. */
function clickPins(spec: NativeGlobeSpec, layerId: string, index: number) {
  const key = (spec.sources[layerId].features[index]?.properties as { k?: string } | undefined)?.k;
  const hit = resolveNativeHit(spec.targets, layerId, key);
  return hit ? pinnedFromHit(hit, [0, 0]) : null;
}

describe("clicking a pin on the globe", () => {
  it("pins the lodging card at the hotel's own coordinates", () => {
    const spec = nativeSpec({ lodgings: [LODGING] });
    expect(clickPins(spec, "globe-lodging-pins", 0)).toEqual({
      kind: "lodging",
      data: LODGING,
      anchorLngLat: [8.6, 50.1],
    });
  });

  it("pins the place card the same way", () => {
    const spec = nativeSpec({ places: [PLACE] });
    expect(clickPins(spec, "globe-place-pins", 0)).toEqual({
      kind: "place",
      data: PLACE,
      anchorLngLat: [8.65, 50.12],
    });
  });

  it("pins nothing for a feature index that is not in the layer's data", () => {
    const spec = nativeSpec({ lodgings: [LODGING] });
    expect(clickPins(spec, "globe-lodging-pins", 5)).toBeNull();
  });
});

const CARD_PROPS = { flights: [], cruises: [], onClose: vi.fn() };

describe("PinnedCard: lodging", () => {
  const pinned: GlobePinned = { kind: "lodging", data: LODGING, anchorLngLat: [8.6, 50.1] };

  it("names the hotel, its stays and its nights, and offers a way to open it", () => {
    const onLodgingOpen = vi.fn();
    render(<PinnedCard {...CARD_PROPS} pinned={pinned} onLodgingOpen={onLodgingOpen} />);
    expect(screen.getByText("Hotel Kramer")).toBeTruthy();
    expect(screen.getByText("lodging:type.hotel")).toBeTruthy();
    expect(screen.getByText("lodging:field.staysCount:3")).toBeTruthy();
    expect(screen.getByText("lodging:field.nightsCount:7")).toBeTruthy();
    expect(screen.getByText("Kempinski")).toBeTruthy();

    fireEvent.click(screen.getByText("map:globe.pinned.openLodging"));
    expect(onLodgingOpen).toHaveBeenCalledWith("l1");
  });

  it("omits the nights row rather than showing a zero", () => {
    // A stay with an unknown span and a same-day stay both come to 0, and
    // only one of those means "no nights" (shared/lodgingTiming.ts).
    render(
      <PinnedCard
        {...CARD_PROPS}
        pinned={{ ...pinned, data: { ...LODGING, nights: 0 } as Lodging }}
      />
    );
    expect(screen.queryByText(/nightsCount/)).toBeNull();
  });

  it("draws no CTA when the caller gave nothing to open", () => {
    render(<PinnedCard {...CARD_PROPS} pinned={pinned} />);
    expect(screen.queryByText("map:globe.pinned.openLodging")).toBeNull();
  });
});

describe("PinnedCard: place", () => {
  it("counts the visits of a visited place and offers the open CTA", () => {
    const onPlaceOpen = vi.fn();
    render(
      <PinnedCard
        {...CARD_PROPS}
        pinned={{ kind: "place", data: PLACE, anchorLngLat: [8.65, 50.12] }}
        onPlaceOpen={onPlaceOpen}
      />
    );
    expect(screen.getByText("Palmengarten")).toBeTruthy();
    expect(screen.getByText("places:categories.nature")).toBeTruthy();
    expect(screen.getByText("places:list.visitsCount:2")).toBeTruthy();

    fireEvent.click(screen.getByText("map:globe.pinned.openPlace"));
    expect(onPlaceOpen).toHaveBeenCalledWith("p1");
  });

  it("says Merkliste for a wishlist entry instead of counting zero visits", () => {
    render(
      <PinnedCard
        {...CARD_PROPS}
        pinned={{ kind: "place", data: WISHLIST, anchorLngLat: [8.65, 50.12] }}
      />
    );
    expect(screen.getByText("places:list.status.wishlist")).toBeTruthy();
    expect(screen.queryByText(/visitsCount/)).toBeNull();
  });
});
