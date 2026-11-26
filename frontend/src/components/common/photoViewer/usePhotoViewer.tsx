import { useCallback, useState, type JSX } from "react";

import PhotoViewer from "../PhotoViewer";
import type { ViewerPhoto } from "./viewerPhoto";

/**
 * `const { open, viewer } = usePhotoViewer();` — call `open(items, index)` from a thumbnail's
 * click and render `{viewer}` once. Keeps every surface to two lines of wiring.
 */
export function usePhotoViewer(): {
  open: (items: ViewerPhoto[], index: number) => void;
  viewer: JSX.Element | null;
} {
  const [state, setState] = useState<{ items: ViewerPhoto[]; index: number } | null>(null);
  const open = useCallback((items: ViewerPhoto[], index: number) => setState({ items, index }), []);
  const close = useCallback(() => setState(null), []);
  const viewer = state ? (
    <PhotoViewer items={state.items} startIndex={state.index} onClose={close} />
  ) : null;
  return { open, viewer };
}
