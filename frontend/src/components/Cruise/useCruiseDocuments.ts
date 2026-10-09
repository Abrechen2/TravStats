import { useCallback, useEffect, useState } from "react";
import { documentsApi } from "../../lib/api/documents";
import type { TravelDocument } from "../../lib/api/documents";
import { logger } from "../../lib/logger";

export type CruiseDocumentsState =
  { status: "loading" } | { status: "ready"; documents: TravelDocument[] } | { status: "failed" };

/**
 * The cruise's documents for the day card, asked only while a card is shown
 * (`cruiseId` null keeps it silent). A failed list is said as such — never an
 * empty one, which would read as "nothing filed" (forgejo#247).
 */
export function useCruiseDocuments(cruiseId: string | null): {
  state: CruiseDocumentsState;
  retry: () => void;
} {
  const [state, setState] = useState<CruiseDocumentsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cruiseId === null) return;
    let cancelled = false;
    setState({ status: "loading" });
    documentsApi
      .listForEntry({ type: "cruise", id: cruiseId })
      .then((documents) => {
        if (!cancelled) setState({ status: "ready", documents });
      })
      .catch((err: unknown) => {
        logger.warn("useCruiseDocuments: failed to list the cruise's documents", err);
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [cruiseId, attempt]);

  const retry = useCallback((): void => setAttempt((n) => n + 1), []);
  return { state, retry };
}
