import { useEffect, useState } from "react";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";

/**
 * Whether the server's WebDAV copy is on: `null` while unknown. An upload that
 * can only answer 409 is not offered, and a row that only works with the copy
 * says so.
 */
export function useWebdavEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    adminApi.getWebDAVSettings().then(
      ({ settings }) => alive && setEnabled(settings.enabled),
      (error: unknown) => {
        logger.error("Failed to load WebDAV settings", error);
      }
    );
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
