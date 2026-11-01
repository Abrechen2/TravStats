import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  chooseValue,
  discardWrite,
  flushWrites,
  readWrite,
  retryWrite,
  subscribeWrites,
  type WriteFn,
  type WriteReason,
  type WriteState,
} from "./writeQueue";

export interface SettingWrite<T> {
  /** What the row shows: the user's choice while a write is open, else the saved value. */
  value: T;
  state: WriteState;
  reason: WriteReason | null;
  choose: (next: T) => void;
  retry: () => void;
  discard: () => void;
}

/**
 * One immediate row's save behaviour (B6).
 *
 * `saved` is what the owner of the data holds right now (a store, a query).
 * Once a write is open the row shows the CHOICE instead — a failed write must
 * not snap back to `saved` on the next render, that is the bug this exists to
 * prevent. Unmounting the row sends a write that is still waiting.
 */
export function useSettingWrite<T>(key: string, saved: T, write: WriteFn<T>): SettingWrite<T> {
  const entry = useSyncExternalStore(
    subscribeWrites,
    () => readWrite<T>(key),
    () => undefined
  );
  const writeRef = useRef(write);
  const savedRef = useRef(saved);
  useEffect(() => {
    writeRef.current = write;
    savedRef.current = saved;
  });

  useEffect(() => () => flushWrites(false, key), [key]);

  const choose = useCallback(
    (next: T): void => {
      chooseValue<T>(key, next, savedRef.current, (v, o) => writeRef.current(v, o));
    },
    [key]
  );
  const retry = useCallback((): void => retryWrite(key), [key]);
  const discard = useCallback((): void => {
    discardWrite<T>(key);
  }, [key]);

  const state: WriteState = entry?.state ?? "idle";
  return {
    value: state === "idle" || !entry ? saved : entry.value,
    state,
    reason: entry?.reason ?? null,
    choose,
    retry,
    discard,
  };
}
