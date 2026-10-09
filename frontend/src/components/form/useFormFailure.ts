import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { focusFirstError } from "./focusFirstError";

/**
 * The glue between a refused save and what the user sees (forgejo#246,
 * forgejo#247), lifted out of the lodging form so eight forms do not each
 * carry their own copy of it (review fix round 1).
 *
 * - **A refusal stays until the next edit AFTER it was shown.** It is stored
 *   with the draft as it is when the refusal ARRIVES (`draftKey`, any string
 *   that changes when the draft does) and shown only while the draft is
 *   unchanged since — no effect that every setter would have to remember to
 *   clear. Not the draft of the click that sent the request: the dialog stays
 *   editable while a save is in flight, and a refusal keyed on the click-time
 *   draft was already stale on arrival — a letter typed meanwhile made the
 *   server's "no" invisible, the dialog just went back to an enabled Save
 *   with nothing said (bus review, Minor 1).
 * - **Field rules show from the first attempt on** (`attempted`), then live:
 *   nobody is scolded mid-keystroke, and a fixed field stops complaining as
 *   soon as it is right.
 * - **Focus goes to the first problem after the render that shows it** —
 *   the first `aria-invalid` field inside `rootRef`, else the error banner.
 *   Asking for it in the same handler that sets the error would find nothing
 *   yet; the request is a counter an effect answers after the commit.
 */
export function useFormFailure(draftKey: string): {
  /** Put on the element that holds the fields and the banner. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** The refusal to show, or null — already null once the draft changed. */
  failureKey: string | null;
  attempted: boolean;
  markAttempted: () => void;
  /** Record a refusal against the draft as it is NOW and move focus to it. */
  fail: (key: string) => void;
  clear: () => void;
  /** Move focus to the first invalid field (or the banner) after this render. */
  focusFirstProblem: () => void;
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [failure, setFailure] = useState<{ key: string; draft: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  // The draft as of the latest committed render. `fail` is called from a
  // handler closed over the render of the click, possibly seconds before the
  // answer; this ref is how it learns what the draft is NOW.
  const latestDraft = useRef(draftKey);
  useLayoutEffect(() => {
    latestDraft.current = draftKey;
  }, [draftKey]);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(rootRef.current);
  }, [focusRequest]);

  const focusFirstProblem = useCallback((): void => setFocusRequest((n) => n + 1), []);
  const fail = useCallback((key: string): void => {
    setFailure({ key, draft: latestDraft.current });
    setFocusRequest((n) => n + 1);
  }, []);
  const clear = useCallback((): void => setFailure(null), []);
  const markAttempted = useCallback((): void => setAttempted(true), []);

  const failureKey = failure !== null && failure.draft === draftKey ? failure.key : null;

  return { rootRef, failureKey, attempted, markAttempted, fail, clear, focusFirstProblem };
}
