import { useEffect, useRef, useState, type RefObject } from "react";

export interface InView<T extends Element> {
  ref: RefObject<T | null>;
  /** On screen (within the margin) right now. */
  inView: boolean;
  /** Has been on screen at least once — for work that should happen once. */
  seen: boolean;
}

/**
 * Whether an element is near the viewport, for cards that must not all do
 * their work at once (forgejo#305: the inbox mounts every card, hidden ones
 * included, and each stay card would otherwise geocode and draw a WebGL map).
 *
 * An element hidden with `hidden`/`display: none` never intersects, so a
 * filtered-out or unselected card stays idle. Without IntersectionObserver
 * (jsdom, very old browsers) nothing is reported, the trade `LazySection`
 * makes: idle rather than everything at once.
 */
export function useInView<T extends Element>(rootMargin = "200px 0px"): InView<T> {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        setInView(visible);
        if (visible) setSeen(true);
      },
      { rootMargin }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView, seen };
}
