import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { tokens } from "../../../theme/tokens";
import type { HoverTooltipState } from "./pinnedTypes";
import { placeTooltip } from "./placeFloating";
import { FLOATING_CARD_Z, sideListInsets } from "./FloatingCard";
import { enrichHoverBox } from "./hoverEnrichment";

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
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Placed after it is drawn: right of and below the pointer, flipped and
  // clamped to stay inside the map (forgejo#323 browser look — it was clipped
  // at the right edge). Written straight to the node, as the show/hide are,
  // so a 60–120 Hz hover still renders once per move and not twice.
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const place = useCallback((): void => {
    const el = boxRef.current;
    const at = pointRef.current;
    const container = el?.offsetParent as HTMLElement | null | undefined;
    if (!el || !at || !container || container.clientWidth === 0) return;
    const box = placeTooltip(
      at,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: container.clientWidth, height: container.clientHeight },
      sideListInsets(container)
    );
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
  }, []);
  useLayoutEffect(() => {
    pointRef.current = state ? { x: state.x, y: state.y } : null;
    place();
  }, [state, place]);

  // The logo, picture and station text fill in after the box is drawn
  // (`hoverEnrichment.ts`) — once per new content, not per pointer move, and
  // re-placed when they change its size.
  const html = state?.html ?? null;
  useEffect(() => {
    const el = boxRef.current;
    if (!el || html === null) return;
    return enrichHoverBox(el, place);
  }, [html, place]);

  // A click opens a card for what the pointer is on; the tooltip for that same
  // object would sit on top of the card (forgejo#323 browser look). So a press
  // hides it and keeps it hidden until the pointer reaches something else.
  const shownRef = useRef<string | null>(null);
  const suppressedRef = useRef<string | null>(null);
  useEffect(() => {
    const onPress = (): void => {
      if (shownRef.current === null) return;
      suppressedRef.current = shownRef.current;
      shownRef.current = null;
      setState(null);
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      show: (next) => {
        if (next.html === suppressedRef.current) return;
        suppressedRef.current = null;
        shownRef.current = next.html;
        setState(next);
      },
      hide: () => {
        shownRef.current = null;
        setState(null);
      },
    }),
    []
  );

  if (!state) return null;
  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute rounded-sm px-3 py-2 text-xs"
      style={{
        left: state.x + 12,
        top: state.y + 12,
        maxWidth: "280px",
        // Above the map's floating panels, like the pinned card (FloatingCard).
        zIndex: FLOATING_CARD_Z,
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
