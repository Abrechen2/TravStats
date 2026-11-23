/**
 * A small gate in front of image requests: at most `MAX_CONCURRENT_THUMBS`
 * thumbnails are in flight at once, the rest wait their turn in the order they
 * asked. A gallery day of 200 photos otherwise opens 200 connections to a
 * photo source that sits behind our own proxy (and, for PhotoPrism, a token
 * per request).
 */
export const MAX_CONCURRENT_THUMBS = 6;

let active = 0;
const waiting: Array<() => void> = [];

function pump(): void {
  while (active < MAX_CONCURRENT_THUMBS && waiting.length > 0) {
    active += 1;
    waiting.shift()?.();
  }
}

/**
 * Ask for a slot. `go` runs once one is free; call the returned `release`
 * when the image has loaded or failed. `cancel` withdraws a request that has
 * not started (the tile scrolled away or unmounted) and is a no-op after.
 */
export function requestThumbSlot(go: () => void): { release: () => void; cancel: () => void } {
  let started = false;
  let released = false;
  const entry = (): void => {
    started = true;
    go();
  };
  waiting.push(entry);
  pump();
  return {
    release: () => {
      if (!started || released) return;
      released = true;
      active -= 1;
      pump();
    },
    cancel: () => {
      if (started) return;
      const i = waiting.indexOf(entry);
      if (i >= 0) waiting.splice(i, 1);
    },
  };
}

/** Test seam: slots in use right now. */
export function activeThumbCount(): number {
  return active;
}
