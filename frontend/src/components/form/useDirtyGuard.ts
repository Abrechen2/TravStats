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
 * `initial` is read ONCE per opening (see `open` below), on the first render: an edit form's starting values
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
  current: unknown,
  options: { open?: boolean } = {}
): { dirty: boolean; markSaved: () => void; reset: (nextInitial?: unknown) => void } {
  const initialSnapshot = stableSnapshot(initial);
  const [baseline, setBaseline] = useState<string>(initialSnapshot);
  const currentSnapshot = stableSnapshot(current);

  // A dialog that stays MOUNTED while closed (`NewRoadtripDialog` renders
  // with `open=false`) starts over each time it opens: the baseline becomes
  // that opening's initial values. Without `open` this never fires, and the
  // first render's `initial` stays the baseline, as described above.
  // Adjusted during render (React's documented pattern for "reset state when
  // a prop changes"), so the reopened form is clean in its FIRST paint.
  const open = options.open ?? true;
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setBaseline(initialSnapshot);
  }

  // Closes over the draft of the render that created it — so a `markSaved`
  // called after `await save(...)` records what was SENT, not whatever the
  // user typed while the request was in flight. That later typing is still a
  // change, and still guarded.
  const markSaved = useCallback((): void => setBaseline(currentSnapshot), [currentSnapshot]);

  /** Start over from `nextInitial`, or from this render's `initial`. */
  const reset = useCallback(
    (nextInitial?: unknown): void =>
      setBaseline(nextInitial === undefined ? initialSnapshot : stableSnapshot(nextInitial)),
    [initialSnapshot]
  );

  return { dirty: currentSnapshot !== baseline, markSaved, reset };
}

/**
 * A stable, comparable form of a draft.
 *
 * Plain `JSON.stringify` was not enough (review, fix round 1): it depends on
 * key ORDER, so a draft assembled in a different order than the record it was
 * built from compared unequal; and it tells `undefined`, `null` and `""` apart,
 * so an edit form whose record says `notes: null` and whose input holds `""`
 * opened already "changed" — and asked "discard changes?" about nothing.
 *
 * So: object keys are sorted, and `undefined`, `null` and `""` are one EMPTY,
 * which also equals an absent key (empty members are dropped). For a form the
 * three are the same answer — "nothing entered" — and the save paths already
 * send them alike. `0` and `false` are values, not empty.
 */
export function stableSnapshot(value: unknown): string {
  return JSON.stringify(normalise(value)) ?? "";
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function normalise(value: unknown): unknown {
  if (isEmpty(value)) return null;
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => !isEmpty(member))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, member]) => [key, normalise(member)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}
