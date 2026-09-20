import { forwardRef, useImperativeHandle, useState } from "react";
import { tokens } from "../../../theme/tokens";
import type { HoverTooltipState } from "./pinnedTypes";

export interface HoverTooltipApi {
  show: (state: HoverTooltipState) => void;
  hide: () => void;
}

// Leaf tooltip rendered out-of-band from its map. Mouse-move events fire
// onHover at ~60–120 Hz; if the tooltip lived in the map component's state,
// every move re-rendered the entire parent (layers + effects + MapboxOverlay
// setProps), which on lower-end GPUs reads as visible jank.
//
// Exposing show/hide via an imperative ref keeps the React tree change scoped
// to this 30-line subtree — the parent only renders once when the ref is
// wired.
//
// Shared by the globe and the flat map since the owner's 2026-09-20 ruling
// ("Globus soll überall genutzt werden"): the flat map used deck.gl's plain
// `getTooltip`, which re-renders nothing but also cannot be styled past a
// style object and never matched the card it sat beside.
export const HoverTooltip = forwardRef<HoverTooltipApi>(function HoverTooltip(_, ref) {
  const [state, setState] = useState<HoverTooltipState | null>(null);

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
        // Own dark glass rather than a theme surface, for the same reason the
        // card has one: it floats over live map imagery.
        background: "rgba(13, 17, 23, 0.92)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${tokens.color.border}`,
        color: tokens.color.text,
        fontFamily: "'Inter', sans-serif",
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
      }}
      dangerouslySetInnerHTML={{ __html: state.html }}
    />
  );
});
