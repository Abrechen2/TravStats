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

/**
 * Whether a WebGL2 context can be created RIGHT NOW. `webgl2Available` is
 * frozen at import; this asks again, because creation can fail later on a
 * machine that managed it once (a driver reset, or the browser's budget of
 * roughly 8-16 live contexts used up by other tabs and maps). The probe
 * context is released at once so it does not count against that budget.
 */
export function probeWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * MapLibre throws `GPUInitializationError` ("WebGL2 is required to display
 * this map.") when the context cannot be created. Matched by name AND
 * message: a bundler can rename the class, the message text is MapLibre's.
 */
export function isWebGLInitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "GPUInitializationError" ||
    /WebGL2? is required|Failed to initialize WebGL/i.test(error.message)
  );
}
