import { useEffect, useState } from "react";

import { tripsApi } from "../lib/api/trips";
import { logger } from "../lib/logger";

/**
 * The moods the user has written in their journal before, for the journal
 * editor's chips. Asked once per opened editor; a failed request offers
 * nothing, because the mood is free text and works without it.
 */
export function useJournalMoods(): string[] {
  const [moods, setMoods] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    tripsApi
      .getJournalMoods()
      .then((next) => {
        if (active) setMoods(next);
      })
      .catch((error: unknown) => {
        logger.warn("Journal moods failed", { error });
      });
    return () => {
      active = false;
    };
  }, []);

  return moods;
}
