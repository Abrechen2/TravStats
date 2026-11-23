import { useEffect, useRef, useState } from "react";
import { requestThumbSlot } from "../../lib/thumbQueue";

/** About two screens of lookahead: the root margin is relative to the viewport. */
const LOOKAHEAD_MARGIN = "200% 0px";
/** Intrinsic size of the provider's grid thumbnail; CSS scales it, this stops layout shift. */
const THUMB_PX = 250;

interface Props {
  src: string;
  alt: string;
}

/**
 * One grid tile image. It asks for its bytes only when it is within about two
 * screens of the viewport, and then only when the shared queue has a free slot
 * (6 at a time) — so opening a day starts the first rows, not the whole day.
 * Without IntersectionObserver (old engines, jsdom) it simply loads.
 */
export default function LazyThumb({ src, alt }: Props): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const [near, setNear] = useState(!hasObserver);
  const [go, setGo] = useState(!hasObserver);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = box.current;
    if (near || !el || !hasObserver) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: LOOKAHEAD_MARGIN }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, hasObserver]);

  useEffect(() => {
    if (!near || go) return undefined;
    const slot = requestThumbSlot(() => setGo(true));
    releaseRef.current = slot.release;
    return () => slot.cancel();
  }, [near, go]);

  // A tile that unmounts while its image is still loading must give the slot back.
  useEffect(() => () => releaseRef.current?.(), []);

  const done = (): void => releaseRef.current?.();

  return (
    <div
      ref={box}
      className="aspect-square w-full overflow-hidden rounded-sm"
      style={{ background: "var(--bg-elevated)" }}
    >
      {go && (
        <img
          src={src}
          alt={alt}
          width={THUMB_PX}
          height={THUMB_PX}
          loading="lazy"
          decoding="async"
          onLoad={done}
          onError={done}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}
