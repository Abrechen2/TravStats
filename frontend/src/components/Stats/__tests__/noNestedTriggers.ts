import { expect } from "vitest";

/**
 * Fails when any evidence trigger sits inside another one.
 *
 * `StatCard` can make a WHOLE card a button, and `EvidenceNumber` can make a
 * number inside that card's description one. Together they nest, which is
 * invalid HTML — and worse than invalid: the inner click bubbles, so the
 * card's `open()` runs last and wins. Measured on the places tab on
 * 2026-09-19, where `placeWishlistCount` silently opened
 * `placesVisitedCount`. React logs the nesting as a warning, which the suite
 * does not fail on, and every key assertion stayed green because the OUTER
 * card's key is a served key too.
 *
 * `StatCard`'s `descriptionHasOwnTrigger` is what prevents it, and a prop a
 * caller must remember is not a guarantee. This is the guarantee: it is
 * called from every surface suite that renders a `StatCard` beside an
 * `EvidenceNumber`, so forgetting the prop fails a test rather than shipping
 * a number that answers someone else's question.
 *
 * A DOM query rather than a dev-time throw on purpose: the defect is
 * structural and visible in the rendered tree, and a throw would have to live
 * in production code to catch a mistake only a test can make.
 */
export function expectNoNestedTriggers(container: HTMLElement): void {
  const nested = Array.from(container.querySelectorAll("button button"));
  expect(
    nested.map((el) => el.getAttribute("aria-label") ?? el.textContent),
    "A trigger inside a trigger: the inner click bubbles and the outer one wins"
  ).toEqual([]);
}
