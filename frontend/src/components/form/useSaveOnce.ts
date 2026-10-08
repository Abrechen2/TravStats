import { useCallback, useRef, useState } from "react";
import { logger } from "../../lib/logger";

/**
 * What one press of "Speichern" came to.
 *
 * - `failed`: the request was refused or never arrived. The draft is intact;
 *   show `error` (through `saveErrorMessage`) and let the user try again.
 * - `saved`: stored, and whatever the caller does next (reload the list,
 *   close the dialog) worked too.
 * - `savedButAfterFailed`: STORED — and then the follow-up failed. This is not
 *   a refusal and must not read like one.
 * - `skipped`: a save is already running, or already succeeded; nothing was sent.
 */
export type SaveOutcome<T> =
  | { status: "failed"; error: unknown }
  | { status: "saved"; value: T }
  | { status: "savedButAfterFailed"; value: T; error: unknown }
  | { status: "skipped" };

/**
 * Save at most once, keep the draft on failure, and never mistake a failed
 * reload for a failed save (forgejo#247).
 *
 * Six forms (cruise, lodging house, stay, place, rail, rental) ran their
 * `onSaved` — "reload the list" — INSIDE the same try as the create request.
 * When the reload failed, the form said "Speichern fehlgeschlagen" about a
 * record that WAS stored, and kept its save button live: the obvious next
 * click created the same record a second time. The bus form did it right, and
 * this is that pattern made shareable:
 *
 * 1. the API call runs in its own try; a failure returns `failed` and changes
 *    nothing else, so the draft stays where it is;
 * 2. success is remembered (`saved`), and from then on `save` sends nothing —
 *    so neither a double click nor a retry after a failed reload can create a
 *    duplicate;
 * 3. `onSaved` runs in a second try whose failure is reported as
 *    `savedButAfterFailed` (and `afterSaveFailed`), for the form to say
 *    `common:form.savedButRefreshFailed` and offer a way out.
 *
 * The in-flight flag is a ref as well as state: two clicks inside one frame
 * both read the state from before either re-rendered, and both would send.
 */
export function useSaveOnce<T>(): {
  save: (
    apiCall: () => Promise<T>,
    onSaved?: (value: T) => void | Promise<void>
  ) => Promise<SaveOutcome<T>>;
  saving: boolean;
  saved: T | null;
  afterSaveFailed: boolean;
} {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<T | null>(null);
  const [afterSaveFailed, setAfterSaveFailed] = useState(false);
  const inFlight = useRef(false);
  const done = useRef(false);

  const save = useCallback(
    async (
      apiCall: () => Promise<T>,
      onSaved?: (value: T) => void | Promise<void>
    ): Promise<SaveOutcome<T>> => {
      if (inFlight.current || done.current) return { status: "skipped" };
      inFlight.current = true;
      setSaving(true);
      let value: T;
      try {
        value = await apiCall();
      } catch (error: unknown) {
        inFlight.current = false;
        setSaving(false);
        return { status: "failed", error };
      }
      done.current = true;
      setSaved(value);
      try {
        await onSaved?.(value);
        return { status: "saved", value };
      } catch (error: unknown) {
        // Stored, so not a refusal — but never silent either.
        logger.error("useSaveOnce: saved, but the follow-up failed", error);
        setAfterSaveFailed(true);
        return { status: "savedButAfterFailed", value, error };
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    []
  );

  return { save, saving, saved, afterSaveFailed };
}
