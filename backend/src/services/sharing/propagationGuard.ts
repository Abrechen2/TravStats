import { AsyncLocalStorage } from "async_hooks";

/**
 * The recursion guard of propagation (design 2026-10-09, "Propagation"): a
 * write made BY propagation — a copy updated, created or restored in another
 * member's account — must not propagate again, or two members' copies would
 * ping-pong the same change between them forever.
 *
 * An AsyncLocalStorage flag rather than a parameter: the propagation writes go
 * through the same services the routes use (a cruise's legs, a stay's house),
 * and a flag that rides the async context cannot be forgotten by one of them.
 */
const propagating = new AsyncLocalStorage<true>();

/** True while a propagation write is running on this async path. */
export function isPropagating(): boolean {
  return propagating.getStore() === true;
}

/** Run `fn` as a propagation: every propagate call inside it is a no-op. */
export function asPropagation<T>(fn: () => Promise<T>): Promise<T> {
  return propagating.run(true, fn);
}
