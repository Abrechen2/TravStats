import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "../../../lib/logger";

/**
 * One request per argument, where only the LATEST one may land (review of
 * forgejo#256/#257, fix round 1). Switching the year pill quickly used to let
 * a slow answer for the old year overwrite the new one, and the old year's
 * figures stayed on screen while the new request ran. Now a change resets to
 * loading, and an answer that is no longer the latest is dropped.
 */
export function useLatestLoad<A, T>(
  fetcher: (arg: A) => Promise<T>,
  arg: A,
  what: string
): { data: T | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const reload = useCallback((): void => {
    latest.current += 1;
    const ticket = latest.current;
    setData(null);
    setFailed(false);
    fetcher(arg)
      .then((result) => {
        if (ticket === latest.current) setData(result);
      })
      .catch((err) => {
        if (ticket !== latest.current) return;
        // A failed load must not read as an empty logbook.
        setFailed(true);
        logger.error(`Failed to load ${what}:`, err);
      });
  }, [fetcher, arg, what]);

  useEffect(() => {
    reload();
    return (): void => {
      // An answer arriving after unmount or after the next request is stale.
      latest.current += 1;
    };
  }, [reload]);

  return { data, failed, reload };
}
