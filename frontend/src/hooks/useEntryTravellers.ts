import { useCallback, useEffect, useState } from "react";

import {
  entryTravellersApi,
  isTravellerEntryType,
  type EntryTraveller,
} from "../lib/api/entryTravellers";
import { logger } from "../lib/logger";

/**
 * The companions on an entry with their own facts and documents (plan D7).
 * Empty for an entry type that has no travellers; `failed` says a load went
 * wrong, so a screen never shows "no companions" over an error.
 */
export function useEntryTravellers(
  type: string,
  id: string,
  enabled: boolean
): { travellers: EntryTraveller[]; failed: boolean; reload: () => Promise<void> } {
  const [travellers, setTravellers] = useState<EntryTraveller[]>([]);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    if (!isTravellerEntryType(type)) return;
    try {
      setTravellers(await entryTravellersApi.list(type, id));
      setFailed(false);
    } catch (err: unknown) {
      logger.error({ err, type, id }, "useEntryTravellers: list failed");
      setFailed(true);
    }
  }, [type, id]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  return { travellers, failed, reload };
}
