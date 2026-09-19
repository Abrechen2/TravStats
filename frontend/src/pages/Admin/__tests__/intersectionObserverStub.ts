/**
 * A controllable IntersectionObserver stub for tests that exercise
 * `LazySection`'s real mount-on-intersect behaviour.
 *
 * jsdom has no IntersectionObserver at all (see `LazySection`'s own doc
 * comment on the trade), so without this a lazy section's body stays
 * unmounted forever and a test cannot see a broken reveal — the exact gap
 * Wave C finding C3 (independent review, 2026-09-17) named against
 * `AdminPage.sections.test.tsx`. Finding C1 (same review) needs the same
 * control to prove the placeholder height and the deep-link re-scroll.
 *
 * `trigger()` still fires after `disconnect()`, deliberately unlike a real
 * browser: the point of some tests here is to prove a component's OWN guard
 * against acting on a redundant intersection twice (see LazySection's
 * `notifiedRef`), which is a different property from "does a disconnected
 * observer redeliver" and should not depend on getting that browser detail
 * right in a fake.
 *
 * Usage: call `installFakeIntersectionObserver()` before rendering, drive
 * intersections through the returned handle's `observerFor(elementId)`, and
 * always call `restore()` afterwards — this replaces the jsdom global for
 * the whole test file otherwise.
 */
export class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private observedElement: Element | undefined;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    onCreate: (observer: FakeIntersectionObserver) => void
  ) {
    onCreate(this);
  }

  observe(target: Element): void {
    this.observedElement = target;
  }

  unobserve(): void {
    this.observedElement = undefined;
  }

  disconnect(): void {
    // Bookkeeping only — see the class doc comment on why `trigger()` does
    // not honour this the way a real browser's observer would.
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** The element `LazySection` handed to `observe()`, if any. */
  get target(): Element | undefined {
    return this.observedElement;
  }

  /** Fires the callback as if the observed element just intersected (or
   *  stopped, with `isIntersecting: false`). `LazySection` only ever reads
   *  `entry.isIntersecting`. */
  trigger(isIntersecting = true): void {
    if (!this.observedElement) return;
    const entry = {
      isIntersecting,
      target: this.observedElement,
    } as unknown as IntersectionObserverEntry;
    this.callback([entry], this);
  }
}

export interface FakeIntersectionObserverHandle {
  /** Every `FakeIntersectionObserver` created since install, in creation order. */
  observers: FakeIntersectionObserver[];
  /** Finds the observer watching a given element (by DOM id), if any. */
  observerFor: (elementId: string) => FakeIntersectionObserver | undefined;
  /** Restores the real (absent, in jsdom) IntersectionObserver global. */
  restore: () => void;
}

export function installFakeIntersectionObserver(): FakeIntersectionObserverHandle {
  const original = globalThis.IntersectionObserver;
  const observers: FakeIntersectionObserver[] = [];

  globalThis.IntersectionObserver = class extends FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      super(callback, (observer) => observers.push(observer));
    }
  } as unknown as typeof IntersectionObserver;

  return {
    observers,
    observerFor: (elementId: string) =>
      observers.find((observer) => observer.target?.id === elementId),
    restore: () => {
      globalThis.IntersectionObserver = original;
    },
  };
}
