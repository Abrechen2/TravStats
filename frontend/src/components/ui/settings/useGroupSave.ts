import { useCallback, useEffect, useRef, useState } from "react";
import { stableSnapshot } from "../../form/useDirtyGuard";
import { registerDirtyGroup } from "./leaveGuard";
import { reasonOf, type WriteReason } from "./writeQueue";

export type GroupState = "unchanged" | "dirty" | "saving" | "saved" | "failed";

export interface GroupSave<T extends Record<string, unknown>> {
  draft: T;
  state: GroupState;
  reason: WriteReason | null;
  /** How many fields differ from the saved ones. */
  changed: readonly (keyof T)[];
  isChanged: (field: keyof T) => boolean;
  edit: (patch: Partial<T>) => void;
  save: () => Promise<boolean>;
  discard: () => void;
}

interface Options<T> {
  /** Unique per group on a page; the leave warning keys on it. */
  id: string;
  /** Names the group in the leave question: "Adressen auf der Seite Server". */
  label: string;
  /** What the server holds. */
  saved: T;
  /**
   * Resolves with the draft as it stands once saved, when that differs from what
   * was sent (a secret that was typed is write-only: it does not stay in the draft).
   */
  write: (draft: T) => Promise<void | T>;
}

/**
 * A group with an explicit save button (B6, group half).
 *
 * The draft is kept apart from `saved`; "Nicht gespeichert" is the draft
 * differing from it. While it does, the group is registered with the leave
 * guard, so the menu, a search hit, a link, Back and a reload all ask first.
 * A failed save keeps the draft — the same promise as the immediate rows.
 */
export function useGroupSave<T extends Record<string, unknown>>({
  id,
  label,
  saved,
  write,
}: Options<T>): GroupSave<T> {
  const [draft, setDraft] = useState<T>(saved);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [reason, setReason] = useState<WriteReason | null>(null);
  const baseline = useRef(saved);

  // The server's value moved while the user is not editing: follow it.
  const savedKey = stableSnapshot(saved);
  const wasKey = useRef(savedKey);
  useEffect(() => {
    if (savedKey === wasKey.current) return;
    const untouched = stableSnapshot(draft) === stableSnapshot(baseline.current);
    wasKey.current = savedKey;
    baseline.current = saved;
    if (untouched) setDraft(saved);
  });

  const changed = (Object.keys(draft) as (keyof T)[]).filter(
    (field) => stableSnapshot(draft[field]) !== stableSnapshot(baseline.current[field])
  );
  const dirty = changed.length > 0;

  const discard = useCallback((): void => {
    setDraft(baseline.current);
    setPhase("idle");
    setReason(null);
  }, []);

  const changedCount = changed.length;
  useEffect(() => {
    if (changedCount === 0) return;
    return registerDirtyGroup(id, { label, count: changedCount, discard });
  }, [id, label, changedCount, discard]);

  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  });

  const save = useCallback(async (): Promise<boolean> => {
    const sent = draft;
    setPhase("saving");
    setReason(null);
    try {
      const settled = (await writeRef.current(sent)) ?? sent;
      baseline.current = settled;
      // Fields edited while the request was out keep the user's value (and stay
      // changed); the rest take the settled one.
      setDraft(
        (current) =>
          Object.fromEntries(
            (Object.keys(settled) as (keyof T)[]).map((k) => [
              k,
              stableSnapshot(current[k]) === stableSnapshot(sent[k]) ? settled[k] : current[k],
            ])
          ) as T
      );
      setPhase("saved");
      return true;
    } catch (error) {
      setReason(reasonOf(error));
      setPhase("failed");
      return false;
    }
  }, [draft]);

  const state: GroupState =
    phase === "saving"
      ? "saving"
      : phase === "failed"
        ? "failed"
        : dirty
          ? "dirty"
          : phase === "saved"
            ? "saved"
            : "unchanged";

  return {
    draft,
    state,
    reason,
    changed,
    isChanged: (field) => changed.includes(field),
    edit: (patch) => {
      setDraft((current) => ({ ...current, ...patch }));
      setPhase((p) => (p === "saving" ? p : "idle"));
    },
    save,
    discard,
  };
}
