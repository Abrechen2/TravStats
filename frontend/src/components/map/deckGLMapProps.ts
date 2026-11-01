// The flat map's props. Split from `DeckGLMap.tsx` (forgejo#386, REF-16).

import { type AppearanceDomain } from "./controlPanelKit";
import type { Layer } from "@deck.gl/core";
import type { Cruise, GeoJSONFeature, Flight } from "../../types";
import type { Lodging } from "../../types/lodging";
import type { Place } from "../../types/place";
import type { MapMode } from "../MapContainer3D";
import type { PlaceLabelList } from "../../lib/placeLabel";

export interface DeckGLMapProps {
  flights: GeoJSONFeature[];
  visMode: MapMode;
  minRouteCount?: number;
  onFlightClick?: (flightId: string) => void;
  onRouteClick?: (flightIds: string[]) => void;
  onEdit?: (flight: Flight) => void;
  /**
   * Fires when the card's "Open (last) flight" action is used. Used to be
   * globe-only; since the two maps share one card (owner ruling 2026-09-20)
   * the flat map needs it too — `onFlightClick` only moves the selection,
   * which is where the reader already is.
   */
  onFlightOpen?: (flightId: string) => void;
  /** Fires when the card's "Open cruise" action is used. The cruise card used
   *  to navigate by itself; the shared card asks its host instead. */
  onCruiseOpen?: (cruiseId: string) => void;
  /** Fires when the lodging card's open action is used. */
  onLodgingOpen?: (lodgingId: string) => void;
  /** Fires when the place card's open action is used. */
  onPlaceOpen?: (placeId: string) => void;
  flightList?: Flight[];
  onResetTrip?: () => void;
  cruises?: Cruise[];
  /** Extra deck.gl layers appended after all internally-built layers. */
  extraLayers?: Layer[];
  /** Which domain appearance sections the control panel exposes. */
  appearanceDomains?: readonly AppearanceDomain[];
  /**
   * Lodging marker-size slider value + setter. Controlled from the PARENT
   * (`MapContainer3D`), unlike the flight/cruise marker sizes which
   * DeckGLMap owns as local state — MapContainer3D is what builds the
   * lodging pin layer (via `buildLodgingPins`) and passes it in as part of
   * `extraLayers`, so it needs to own the value to re-memo on it. DeckGLMap
   * only needs it to render the slider in the flat-map control panel.
   * Both default to a no-op 1× so callers that don't use the lodging
   * domain (every tab except LodgingTab) are unaffected.
   */
  lodgingMarkerSize?: number;
  onLodgingMarkerSizeChange?: (s: number) => void;
  /**
   * Lodging places (hotels/campsites) to render as pins + name labels.
   * Built into a ScatterplotLayer + TextLayer HERE (not by the caller, via
   * `buildLodgingPins`) — unlike the marker-size value above, the pin layer
   * itself needs `zoom`, which is private state that only exists inside
   * this component (mirrors exactly how
   * `createCruisePortsLayer` is built here rather than by MapContainer3D).
   * Undefined/empty means "no lodging layer at all".
   */
  lodgingsOverride?: readonly Lodging[];
  /**
   * Fired when a lodging pin is clicked — receives the lodging id. Wrapped
   * internally so the click also sets `deckClickedRef` (see
   * `handleLodgingClick`), the same guard `handleAirportClick`/
   * `handleFlightClick` use to stop the native background-click handler
   * from immediately clearing whatever the click just did.
   */
  onLodgingClick?: (lodgingId: string) => void;
  /**
   * Places to render as pins + name labels. Built HERE rather than by the
   * caller for the same reason `lodgingsOverride` is: the layer needs `zoom`,
   * which is private to this component.
   *
   * Until 2026-08-28 both PoiTab and AllTab called `buildPlacePins` themselves
   * and passed it into `extraLayers`, which is why places were the one domain
   * whose labels never opened up on zoom — the tab had no zoom to give and
   * passed a literal `4` — and the one domain with no size slider, for the same
   * reason. Undefined/empty means no place layer at all.
   */
  placesOverride?: readonly Place[];
  /** Fired when a place pin is clicked. Wrapped internally with the
   *  `deckClickedRef` guard, exactly as the lodging and airport clicks are. */
  onPlaceClick?: (placeId: string) => void;
  /** Place-id → its list's colour, resolved by the caller (`list` colour mode
   *  only). Passed through untouched: a layer resolving list membership itself
   *  would be a second place deciding what a pin means. */
  placeListColors?: ReadonlyMap<string, [number, number, number]>;
  /** Place-id → the label default of the SAME list that gave it its colour,
   *  resolved by the caller through `resolvePlaceListColors`. Passed through
   *  untouched, for the reason `placeListColors` is. */
  placeListLabels?: ReadonlyMap<string, PlaceLabelList>;
  /** Marker-size slider value + setter for places, owned by `MapContainer3D`
   *  exactly as the lodging pair is. */
  placeMarkerSize?: number;
  onPlaceMarkerSizeChange?: (s: number) => void;
}
