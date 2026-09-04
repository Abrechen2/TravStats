import { create } from "zustand";

/**
 * Where the user last left the camera, per map engine — for THIS session only.
 *
 * Every dashboard tab owns its own `MapContainer3D`, so switching domains (or
 * saving an entry, which remounts the tab through `key={refreshToken}`) mounts
 * a fresh `DeckGLMap` / `GlobeView`. Both hand MapLibre a constant
 * `initialViewState`, and `reuseMaps` re-applies exactly that on every reuse
 * (`@vis.gl/react-maplibre` `maplibre.js`, `_updateViewState(initialViewState)`
 * inside `reuse`) — so a user zoomed into Berlin on the flight tab landed back
 * at zoom 2 on the cruise tab, every time (#290). The map now seeds itself
 * from here instead, and writes back on every `moveend`.
 *
 * Two engines, two entries: the flat map and the globe use different zoom
 * scales for the same framing (zoom 2 flat is roughly zoom 1.6 on the globe),
 * so a camera from one would be wrong on the other.
 *
 * Deliberately NOT persisted. Surviving a reload is a product decision the
 * owner has not taken; surviving a tab switch is a bug fix.
 */
export type MapCameraEngine = "flat" | "globe";

export interface MapCamera {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

interface MapCameraState {
  camera: Partial<Record<MapCameraEngine, MapCamera>>;
  remember: (engine: MapCameraEngine, view: MapCamera) => void;
}

export const useMapCameraStore = create<MapCameraState>((set) => ({
  camera: {},
  remember: (engine, view) =>
    set((state) => ({
      camera: {
        ...state.camera,
        // Picked field by field: the MapLibre event's viewState also carries
        // `padding`, which must not leak into the next mount's initial state.
        [engine]: {
          longitude: view.longitude,
          latitude: view.latitude,
          zoom: view.zoom,
          pitch: view.pitch,
          bearing: view.bearing,
        },
      },
    })),
}));
