/**
 * Whether a map may be taken from react-map-gl's recycling pool.
 *
 * Several maps pass `reuseMaps` so that a tab or domain switch does not build a
 * new WebGL context and reload the style. A recycled map is kept alive, context
 * and all, until the next map takes it. That is only safe while its context is
 * healthy: a map whose context was LOST goes into the pool like any other, and
 * the next map to mount would pop it and show a dead canvas that never fires
 * another loss event (forgejo#332). `WebGLGuard` therefore switches reuse off
 * for the rest of the page's life the first time it hears a loss; every map
 * after that is built fresh, and the dead one is simply never popped again.
 */
let reuseEnabled = true;

export function reuseMapsEnabled(): boolean {
  return reuseEnabled;
}

export function disableMapReuse(): void {
  reuseEnabled = false;
}

/** Test seam: restores the page-start state. */
export function resetMapReuseForTests(): void {
  reuseEnabled = true;
}
