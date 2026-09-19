import { useEffect, useState } from "react";

import { documentsApi, type DocumentEntryRef } from "../lib/api/documents";
import { logger } from "../lib/logger";

/**
 * How many kept originals hang off one entry — asked only when it matters.
 *
 * Every one of the five entry types the documents API serves carries
 * `onDelete: Cascade` on `Document`, proven live against the database by
 * `backend/src/__tests__/integrity/cascades.integrity.test.ts` (7/7 on
 * 2026-09-19): deleting a flight, a cruise, a stay, a place visit or a trip
 * takes its documents with it. The write-path audit of the same day filed that
 * as findings 3 and 6 — the cascade is real, and not one confirm dialog named
 * it. A boarding pass or a hotel bill is frequently the only copy there is.
 *
 * Pass `null` for "do not ask yet". The five dialogs pass the entry only once
 * the confirmation is opening, so a detail page still costs the same requests
 * it did before: a reader who never reaches for the delete button never pays
 * for this. That is also why the count is not derived from the
 * `DocumentsSection` already on the page — the section is a sibling, it is
 * absent on the place-visit and stay dialogs' own surfaces, and reaching
 * across for its state would couple a warning to a panel the user may have
 * collapsed.
 *
 * `null` means "unknown", never "none": while the request is in flight, and
 * after one that failed. The dialog shows its base sentence then and opens at
 * once — a warning is worth adding to a question, never worth delaying it.
 *
 * **The shared demo account is NOT exempted, and that was measured rather than
 * assumed.** Skipping the request there would have been free if the demo could
 * not delete anyway, so the five delete routes were read: none of
 * `DELETE /flights/:id`, `/cruises/:id`, `/lodging/:id/stays/:stayId`,
 * `/places/visits/:visitId` or `/trips/:id` mounts `rejectDemo` or
 * `rejectDemoWrites`, and none of their routers mounts one globally — the demo
 * is refused on credentials, connections and quota (`middleware/demoGuard.ts`
 * says so: "Travel data stays editable; a nightly reseed restores it"), not on
 * travel data. So a visitor of a public preview really does delete the entry
 * AND its documents, and is the reader least likely to know what a cascade is.
 * The list endpoint the count uses carries `authenticate` alone
 * (`backend/src/routes/documents.ts`, the `ENTRY_LIST_PATHS` loop), so the demo
 * can read it; `rejectDemo` guards the upload, patch and delete there, not the
 * read. An exemption would have bought one request and cost the warning to
 * exactly the account that needs it most.
 */
export function useDocumentCount(entry: DocumentEntryRef | null): number | null {
  const [count, setCount] = useState<number | null>(null);

  // Depend on the two FIELDS, not the object: callers build the ref inline
  // (`{ type: "flight", id: flight.id }`), so a new identity arrives on every
  // render and an object dependency would re-fetch forever.
  const type = entry?.type ?? null;
  const id = entry?.id ?? null;

  useEffect(() => {
    if (type === null || id === null) {
      setCount(null);
      return;
    }

    let cancelled = false;
    // Reset first: the stay dialog is one component reused for every stay, so
    // without this the second stay's question would carry the first's count.
    setCount(null);

    void (async () => {
      try {
        const documents = await documentsApi.listForEntry({ type, id });
        if (!cancelled) setCount(documents.length);
      } catch (err: unknown) {
        // Deliberately swallowed for the UI: the count stays unknown and the
        // dialog keeps its base sentence. Logged, because a list endpoint that
        // fails here also fails for the panel that shows the documents.
        logger.error({ err }, "useDocumentCount: failed to count documents for an entry");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [type, id]);

  return count;
}
