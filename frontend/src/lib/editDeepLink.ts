import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Links that open an editor, not just a page.
 *
 * The inbox asks the user to supply a time or a zone the migration could not
 * work out (ADR 0002, plan Phase 3b). A link that lands on the record and
 * leaves the user to find the edit button — and on a trip, the right stop
 * among twenty — is half an answer. These query parameters name the editor to
 * open; the detail page opens it once the record has loaded and then removes
 * the parameter, so a reload or a Back does not open it a second time.
 */
export const EDIT_PARAM = {
  /** Flight, rail journey, cruise, trip, place: open the record's own editor. */
  edit: "edit",
  /** Trip: open the editor of the stop with this id. */
  editStop: "editStop",
  /** Place: open the editor of the visit with this id. */
  editVisit: "editVisit",
  /** Trip: open the editor of the journal entry with this id. */
  editJournal: "editJournal",
  /** Lodging: open the editor of the stay with this id. */
  editStay: "editStay",
} as const;

export type EditParam = (typeof EDIT_PARAM)[keyof typeof EDIT_PARAM];

/**
 * Open an editor named in the URL, once `ready` (the record is loaded).
 * `open` receives the parameter's value and is read through a ref, so a new
 * function identity per render does not re-fire it.
 */
export function useEditDeepLink(
  param: EditParam,
  ready: boolean,
  open: (value: string) => void
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(param);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!ready || value === null) return;
    openRef.current(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(param);
        return next;
      },
      { replace: true }
    );
  }, [ready, value, param, setSearchParams]);
}
