import { useEffect } from "react";
import { immichApi } from "../../lib/api/immich";
import { requestThumbSlot } from "../../lib/thumbQueue";

/** One row of the grid on a wide screen. */
const PREFETCH_PHOTOS = 5;

interface Args {
  tripId: string;
  linkId: string;
  /** Day keys in order; empty switches prefetching off. */
  keys: readonly string[];
  current: string;
  enabled: boolean;
}

type IdleHandle = { cancel: () => void };

function whenIdle(run: () => void): IdleHandle {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(run, { timeout: 3000 });
    return { cancel: () => w.cancelIdleCallback?.(h) };
  }
  const h = window.setTimeout(run, 1500);
  return { cancel: () => window.clearTimeout(h) };
}

/**
 * Once the open day has settled, warm the browser cache with the first row of
 * the NEXT day, so stepping forward through a trip does not start from blank
 * tiles. It goes through the same 6-at-a-time queue as the grid and fails
 * silently on purpose: a prefetch is a guess, and the day itself reports its
 * own failure when the user really opens it.
 */
export function useDayPrefetch({ tripId, linkId, keys, current, enabled }: Args): void {
  const next = keys[keys.indexOf(current) + 1];
  useEffect(() => {
    if (!enabled || !next || keys.indexOf(current) < 0) return undefined;
    let cancelled = false;
    let slot: ReturnType<typeof requestThumbSlot> | null = null;
    const idle = whenIdle(() => {
      void immichApi
        .getAlbumDayAssets(tripId, linkId, next, 0, PREFETCH_PHOTOS)
        .then((page) => {
          if (cancelled) return;
          page.assets.forEach((asset) => {
            const slotForOne = requestThumbSlot(() => {
              const img = new Image();
              img.onload = img.onerror = () => slotForOne.release();
              img.src = asset.url;
            });
            slot = slotForOne;
          });
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      idle.cancel();
      slot?.cancel();
    };
    // `keys` is rebuilt every render; the day boundaries are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keys` identity changes each render, `next` carries its content
  }, [tripId, linkId, current, next, enabled]);
}
