// Globe-only chrome (auto-rotation, day/night shading). Deliberately a
// SEPARATE blob from mapAppearance.v2: that one is shared 2D↔3D by design,
// and these two switches have no meaning on the flat map. Without this key
// they were plain useState — the only map settings that reset on reload
// (found in the 2026-08-03 persistence audit).

const KEY = "globeChrome.v1";

export interface GlobeChrome {
  autoRotate?: boolean;
  showNight?: boolean;
}

export function loadGlobeChrome(): GlobeChrome {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const p = parsed as Record<string, unknown>;
    return {
      autoRotate: typeof p.autoRotate === "boolean" ? p.autoRotate : undefined,
      showNight: typeof p.showNight === "boolean" ? p.showNight : undefined,
    };
  } catch {
    return {};
  }
}

export function saveGlobeChrome(next: GlobeChrome): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage full / disabled — the globe still works, just forgets.
  }
}
