import { useCallback, useState } from "react";

/**
 * "Has the user changed anything?" for a form, answered from its draft
 * (forgejo#248).
 *
 * The answer comes from comparing a serialised SNAPSHOT of the draft, not from
 * a "touched" flag set in onChange handlers: a flag stays set when the user
 * types a letter and deletes it again, and asking "discard changes?" about a
 * form that is byte-for-byte what it was is the kind of question that teaches
 * people to click through it. It also cannot be forgotten by the next field
 * someone adds — it is in the draft or it is not saved at all.
 *
 * `initial` is read ONCE, on the first render: an edit form's starting values
 * are the record as it was opened, and a parent re-rendering with a fresh
 * object must not move that baseline. `markSaved` moves it to whatever the
 * draft was when the save started — a successful save ends the protection, as the issue asks,
 * even for a form that stays open afterwards.
 *
 * Only put what the user can SEE and what would be SAVED into the draft. UI
 * state (an open section, a status line) is not a change worth asking about.
 */
export function useDirtyGuard(
  initial: unknown,
  current: unknown
): { dirty: boolean; markSaved: () => void } {
  const [baseline, setBaseline] = useState<string>(() => snapshot(initial));
  const currentSnapshot = snapshot(current);

  // Closes over the draft of the render that created it — so a `markSaved`
  // called after `await save(...)` records what was SENT, not whatever the
  // user typed while the request was in flight. That later typing is still a
  // change, and still guarded.
  const markSaved = useCallback((): void => setBaseline(currentSnapshot), [currentSnapshot]);

  return { dirty: currentSnapshot !== baseline, markSaved };
}

/** JSON is enough: a draft is plain data, and `undefined` vs absent is no change. */
function snapshot(value: unknown): string {
  return JSON.stringify(value) ?? "";
}
