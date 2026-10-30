import { useEffect, useRef, useState } from "react";
import { logger } from "../lib/logger";

/**
 * Loads one domain's data for a multi-domain view and reports whether it
 * FAILED, so the view can say which domain is missing instead of drawing a
 * map without it and no message (forgejo#371). Nothing is fetched while
 * `enabled` is false. `load`/`apply` are read through refs: their identity
 * must not refetch, only `enabled` (or `reloadKey`) does.
 */
export function useDomainLoad<T>(
  domain: string,
  enabled: boolean,
  load: () => Promise<T>,
  apply: (value: T) => void,
  reloadKey = 0
): boolean {
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  const applyRef = useRef(apply);
  loadRef.current = load;
  applyRef.current = apply;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const value = await loadRef.current();
        if (cancelled) return;
        applyRef.current(value);
        setFailed(false);
      } catch (err: unknown) {
        if (cancelled) return;
        logger.error(`useDomainLoad: failed to load ${domain}`, err);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, enabled, reloadKey]);

  return failed;
}
