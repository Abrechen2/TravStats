import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useSectionInView } from "../useSectionInView";

/**
 * The scroll-spy behind the settings and admin index columns.
 *
 * The case that matters is the one the tester found: a SHORT last section
 * can never push its own top into the upper third of the viewport, so the
 * IntersectionObserver has no way to name it and its menu entry stays dead.
 * SettingsPage used to buy the missing scroll room with a spacer about one
 * viewport tall below the last card — a screenful of nothing, which the
 * tester then reported as ugly. The rule that makes the spacer unnecessary
 * lives in the hook: at the bottom of the document, the last section wins.
 *
 * jsdom neither lays out nor scrolls, so both halves are stubbed:
 * `IntersectionObserver` is absent entirely and is replaced by the fake
 * below, and the scroll metrics are `Object.defineProperty` stubs. The
 * shared `pages/Admin/__tests__/intersectionObserverStub.ts` is deliberately
 * not reused — it models ONE observed element per observer and reports no
 * `boundingClientRect`, while this hook watches every landmark through a
 * single observer and reads the rect.
 */

interface FakeObserverHandle {
  /** Reports the given sections as intersecting, in document order. */
  intersect: (...sections: string[]) => void;
  restore: () => void;
}

function installFakeObserver(): FakeObserverHandle {
  const original = globalThis.IntersectionObserver;
  let fire: ((entries: IntersectionObserverEntry[]) => void) | null = null;
  const targets: Element[] = [];

  class SpyObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];

    constructor(callback: IntersectionObserverCallback) {
      fire = (entries) => callback(entries, this);
    }

    observe(target: Element): void {
      targets.push(target);
    }

    unobserve(): void {}

    disconnect(): void {
      fire = null;
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  globalThis.IntersectionObserver = SpyObserver as unknown as typeof IntersectionObserver;

  return {
    intersect: (...sections: string[]) => {
      const observedIds = sections.map((section) => `settings-${section}`);
      const entries = targets.map(
        (target, index) =>
          ({
            target,
            isIntersecting: observedIds.includes(target.id),
            boundingClientRect: { top: index * 100 } as DOMRectReadOnly,
          }) as unknown as IntersectionObserverEntry
      );
      act(() => fire?.(entries));
    },
    restore: () => {
      globalThis.IntersectionObserver = original;
    },
  };
}

/** jsdom reports 0 for every layout measure, so the page has to be faked. */
function setScrollMetrics(options: {
  scrollHeight: number;
  innerHeight: number;
  scrollY: number;
}): void {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: options.scrollHeight,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: options.innerHeight,
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: options.scrollY });
}

const SECTIONS = ["profile", "units", "about"] as const;

function renderLandmarks(): void {
  document.body.innerHTML = SECTIONS.map((id) => `<section id="settings-${id}"></section>`).join(
    ""
  );
}

describe("useSectionInView", () => {
  let observer: FakeObserverHandle;

  beforeEach(() => {
    renderLandmarks();
    observer = installFakeObserver();
  });

  afterEach(() => {
    observer.restore();
    document.body.innerHTML = "";
  });

  it("marks the last section once the document is scrolled to its end, however short that section is", () => {
    // 2400px of page in a 800px viewport: 1600px of scroll to give away.
    setScrollMetrics({ scrollHeight: 2400, innerHeight: 800, scrollY: 400 });
    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));

    // Part-way down, the observer can only ever see the section ABOVE the
    // short last one — the dead menu entry the spacer used to work around.
    observer.intersect("units");
    expect(result.current).toBe("units");

    setScrollMetrics({ scrollHeight: 2400, innerHeight: 800, scrollY: 1600 });
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe("about");
  });

  it("leaves the observer's pick alone while there is still page below", () => {
    setScrollMetrics({ scrollHeight: 2400, innerHeight: 800, scrollY: 400 });
    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));

    observer.intersect("units");
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe("units");
  });

  it("does not mark the last section on a page that cannot scroll at all", () => {
    setScrollMetrics({ scrollHeight: 600, innerHeight: 800, scrollY: 0 });
    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));

    observer.intersect("profile");
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(result.current).toBe("profile");
  });

  it("still answers when the browser has no IntersectionObserver", () => {
    // Back to jsdom's own state, where the global is simply absent.
    observer.restore();
    setScrollMetrics({ scrollHeight: 600, innerHeight: 800, scrollY: 0 });

    const { result } = renderHook(() => useSectionInView(SECTIONS, "settings"));
    expect(result.current).toBe("profile");
  });
});
