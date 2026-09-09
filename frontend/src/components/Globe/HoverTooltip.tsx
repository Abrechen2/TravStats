import { forwardRef, useImperativeHandle, useState } from "react";
import type { TooltipState } from "./globeLayerTypes";

export interface HoverTooltipApi {
  show: (state: TooltipState) => void;
  hide: () => void;
}

// Leaf tooltip rendered out-of-band from GlobeView. Mouse-move events on the
// globe fire onHover at ~60–120 Hz; if the tooltip lived in GlobeView state,
// every move re-rendered the entire 1600-line parent (layers + effects +
// MapboxOverlay setProps), which on lower-end GPUs reads as visible jank.
//
// Exposing show/hide via an imperative ref keeps the React tree change scoped
// to this 30-line subtree — the parent only renders once when the ref is
// wired.
export const HoverTooltip = forwardRef<HoverTooltipApi>(function HoverTooltip(_, ref) {
  const [state, setState] = useState<TooltipState | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      show: (next) => setState(next),
      hide: () => setState(null),
    }),
    []
  );

  if (!state) return null;
  return (
    <div
      className="pointer-events-none absolute z-30 rounded-sm px-3 py-2 text-xs"
      style={{
        left: state.x + 12,
        top: state.y + 12,
        maxWidth: "280px",
        background: "rgba(13, 17, 23, 0.92)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.22)",
        color: "rgba(241,245,249,0.95)",
        fontFamily: "'Inter', sans-serif",
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
      }}
      dangerouslySetInnerHTML={{ __html: state.html }}
    />
  );
});
