import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const SWIPE_PX = 50;

interface View {
  scale: number;
  x: number;
  y: number;
}

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Pinch, wheel and double-tap zoom plus drag-to-pan for the viewer's picture, and a swipe
 * callback that fires only while the picture is not zoomed (a zoomed drag pans instead).
 */
export function useZoomPan(onSwipe: (delta: -1 | 1) => void) {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; view: View } | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => setView({ scale: 1, x: 0, y: 0 }), []);

  const onPointerDown = (e: PointerEvent): void => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: distance(a, b), scale: view.scale };
      swipeStart.current = null;
      return;
    }
    dragStart.current = { x: e.clientX, y: e.clientY, view };
    swipeStart.current = view.scale === 1 ? { x: e.clientX, y: e.clientY } : null;
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const scale = clampScale(
        (pinchStart.current.scale * distance(a, b)) / pinchStart.current.dist
      );
      setView((v) => (scale === 1 ? { scale, x: 0, y: 0 } : { ...v, scale }));
      return;
    }
    const start = dragStart.current;
    if (start && start.view.scale > 1) {
      setView({
        scale: start.view.scale,
        x: start.view.x + (e.clientX - start.x),
        y: start.view.y + (e.clientY - start.y),
      });
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    const swipe = swipeStart.current;
    swipeStart.current = null;
    dragStart.current = null;
    if (!swipe || view.scale !== 1) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
  };

  const onWheel = (e: WheelEvent): void => {
    const scale = clampScale(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    setView(scale === 1 ? { scale, x: 0, y: 0 } : { ...view, scale });
  };

  const onDoubleClick = (): void =>
    setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { ...v, scale: DOUBLE_TAP_SCALE }));

  return {
    view,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel, onDoubleClick },
  };
}
