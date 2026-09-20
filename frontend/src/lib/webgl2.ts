/**
 * Whether this device can run deck.gl at all.
 *
 * Probed ONCE at import: the answer cannot change for the life of the page,
 * and `getContext("webgl2")` on a throwaway canvas is not free.
 *
 * It lived in `components/map/DeckGLOverlay.tsx`, which is where the flat map
 * needed it — and the flat map is the only surface with a fallback for a `no`
 * (`NativeRoutesLayer` plus a notice). Once the globe became every tab's
 * default (owner ruling 2026-09-20), the dashboard's mode registry needed the
 * same answer, and a `types/` module cannot import a component. So the probe
 * lives here and `DeckGLOverlay` re-exports it under its old name.
 */
function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null;
  } catch {
    // A jsdom or SSR environment has no canvas at all. Answering "no" is the
    // safe side: it opens the flat map, which degrades further on its own.
    return false;
  }
}

export const webgl2Available = hasWebGL2();
