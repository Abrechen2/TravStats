/**
 * A controllable ResizeObserver stub, the same shape as
 * `intersectionObserverStub.ts` and for the same reason: jsdom has no
 * ResizeObserver at all, so `AdminPage`'s deep-link scroll aligner (Wave C
 * finding C1, follow-up round after a browser measurement showed the
 * mount-based correction never fired) is otherwise untestable — there is no
 * way to simulate "a section above the deep-link target just grew".
 *
 * `trigger()` deliberately still fires after `disconnect()`, same rationale
 * as the IntersectionObserver stub: some tests here exist to prove the
 * component's OWN time-budget/cancel guards, which is a different property
 * from "does a disconnected observer redeliver in a real browser".
 */
export class FakeResizeObserver implements ResizeObserver {
  private observedElement: Element | undefined;

  constructor(
    private readonly callback: ResizeObserverCallback,
    onCreate: (observer: FakeResizeObserver) => void
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
    // Bookkeeping only — see the class doc comment.
  }

  /** The element the aligner handed to `observe()`, if any. */
  get target(): Element | undefined {
    return this.observedElement;
  }

  /** Fires the callback as if the observed element's size just changed.
   *  `AdminPage`'s aligner only reacts to being called at all — it re-reads
   *  the target's position itself rather than using the entry's contents. */
  trigger(): void {
    if (!this.observedElement) return;
    const entry = { target: this.observedElement } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }
}

export interface FakeResizeObserverHandle {
  /** Every `FakeResizeObserver` created since install, in creation order. */
  observers: FakeResizeObserver[];
  /** Restores the real (absent, in jsdom) ResizeObserver global. */
  restore: () => void;
}

export function installFakeResizeObserver(): FakeResizeObserverHandle {
  const original = globalThis.ResizeObserver;
  const observers: FakeResizeObserver[] = [];

  globalThis.ResizeObserver = class extends FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback, (observer) => observers.push(observer));
    }
  } as unknown as typeof ResizeObserver;

  return {
    observers,
    restore: () => {
      globalThis.ResizeObserver = original;
    },
  };
}
