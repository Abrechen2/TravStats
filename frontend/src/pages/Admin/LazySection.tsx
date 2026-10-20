import { useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from "react";

interface LazySectionProps {
  /** The DOM id the index anchors and `?section=` deep links target. */
  id: string;
  ariaLabel: string;
  /** Fires exactly once, the first time this section becomes visible. */
  onVisible?: () => void;
  children: ReactNode;
}

/** Matches the scroll target settings uses, so the two index columns feel identical. */
const SCROLL_MARGIN_TOP = "calc(var(--ts-size-web-header) + 16px)";

/**
 * Placeholder height reserved for a section before it mounts (Wave C finding
 * C1, independent review 2026-09-17): at height 0 every unmounted section on
 * a tab collapsed to the same point, which put ALL of them inside the
 * observer's 200px root margin at once — the very first paint fired every
 * section's onVisible/fetch, so "lazy" bought nothing. 240px approximates
 * the shortest real admin card: `Card`'s own padding is 2x`--ts-space-xxl`
 * (56px total) plus a heading line and one row of controls — enough to keep
 * sections spread out roughly the way their real content will, without
 * reserving so much that the page balloons before anything has loaded.
 */
const PLACEHOLDER_HEIGHT_PX = 240;

/**
 * Defers a section's real content until it has been near the viewport at
 * least once, so that mounting every admin section on one page (round 4)
 * does not fire every section's on-mount fetch at page load — ships, ports,
 * airlines, aircraft, airports, instance info, usage stats, backups,
 * WebDAV, SMTP and the logging/global-API-key/Immich data an `onVisible`
 * caller wires up. See `LAZY_ADMIN_SECTIONS` for exactly which sections
 * this wraps.
 *
 * The wrapping element keeps the `id` (and `scrollMarginTop`) even before
 * its content mounts, so a `?section=` deep link and the index's anchor
 * links have something to scroll to right away; scrolling a section into
 * view is itself what makes the IntersectionObserver report it and mount
 * the real content.
 *
 * DELIBERATE CHOICE: without IntersectionObserver support (jsdom in tests,
 * and any pre-2017 browser) a section here simply never reveals its content
 * — the same trade SettingsPage's scroll-spy already made ("absent in
 * jsdom, the index simply marks nothing"), rather than falling back to an
 * eager mount that would have forced every unit test to mock a dozen admin
 * endpoints it isn't actually testing. Real browsers overwhelmingly support
 * IntersectionObserver, so this only needs confirming visually — see the
 * task report.
 */
export function LazySection({ id, ariaLabel, onVisible, children }: LazySectionProps): JSX.Element {
  const { ref, visible } = useRevealOnce<HTMLElement>(onVisible);
  return (
    <section
      ref={ref}
      id={id}
      aria-label={ariaLabel}
      style={{
        scrollMarginTop: SCROLL_MARGIN_TOP,
        // Only reserved before mount — real content decides its own height
        // once it is there, rather than being floored at the placeholder.
        ...(visible ? {} : { minHeight: PLACEHOLDER_HEIGHT_PX }),
      }}
    >
      {visible ? children : null}
    </section>
  );
}

/**
 * The same deferral for a body inside a section frame (forgejo#321): the frame
 * owns the landmark and heading, so the heading shows at once and only the
 * card's content waits for the viewport.
 */
export function LazyBody({
  id,
  onVisible,
  children,
}: {
  /** `<section anchor>-body`, so a test can drive this body's observer. */
  id?: string;
  onVisible?: () => void;
  children: ReactNode;
}): JSX.Element {
  const { ref, visible } = useRevealOnce<HTMLDivElement>(onVisible);
  return (
    <div id={id} ref={ref} style={visible ? undefined : { minHeight: PLACEHOLDER_HEIGHT_PX }}>
      {visible ? children : null}
    </div>
  );
}

/** Reports the first time `ref`'s element comes near the viewport, once. */
function useRevealOnce<T extends Element>(
  onVisible?: () => void
): { ref: RefObject<T | null>; visible: boolean } {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // A generous margin: the section is mounted a little before it
      // actually reaches the screen, so scrolling to it never shows a blank
      // beat while the request that fills it is still in flight.
      { rootMargin: "200px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible && !notifiedRef.current) {
      notifiedRef.current = true;
      onVisibleRef.current?.();
    }
  }, [visible]);

  return { ref, visible };
}
