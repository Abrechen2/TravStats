import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";

export interface WebdavStatus {
  /** Whether the server's WebDAV copy is on: `null` while unknown or when the read failed. */
  enabled: boolean | null;
  /** The status could not be read — the page says so instead of quietly hiding what needs WebDAV. */
  failed: boolean;
  retry: () => void;
}

/**
 * The server's WebDAV copy: an upload that can only answer 409 is not offered,
 * and a row that only works with the copy says so. A failed read is a state of
 * its own — "unknown" and "off" must not look alike to the person reading.
 */
export function useWebdavEnabled(): WebdavStatus {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    adminApi.getWebDAVSettings().then(
      ({ settings }) => {
        if (!alive) return;
        setEnabled(settings.enabled);
        setFailed(false);
      },
      (error: unknown) => {
        logger.error("Failed to load WebDAV settings", error);
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { enabled, failed, retry };
}
