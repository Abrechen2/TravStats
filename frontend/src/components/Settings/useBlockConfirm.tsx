import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { ConfirmDialog } from "../ui/settings";

export interface BlockConfirmRequest {
  title: ReactNode;
  affects: ReactNode;
  amount: ReactNode;
  after: ReactNode;
  confirmLabel: string;
  word?: string;
}

interface Pending extends BlockConfirmRequest {
  resolve: (answer: boolean) => void;
}

/**
 * `await confirm(...)` in front of the settings area's confirmation block (B9).
 * Same call shape as `useConfirmDialog`, but the dialog is the design's: what it
 * affects, how much, what is true afterwards, a button that names the amount.
 * An unanswered question counts as "no" when the component unmounts.
 */
export function useBlockConfirm(): {
  confirm: (request: BlockConfirmRequest) => Promise<boolean>;
  dialog: JSX.Element | null;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);

  const settle = useCallback((answer: boolean): void => {
    const current = ref.current;
    ref.current = null;
    setPending(null);
    current?.resolve(answer);
  }, []);

  const confirm = useCallback(
    (request: BlockConfirmRequest): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        ref.current?.resolve(false);
        const next = { ...request, resolve };
        ref.current = next;
        setPending(next);
      }),
    []
  );

  useEffect(
    () => () => {
      ref.current?.resolve(false);
      ref.current = null;
    },
    []
  );

  const dialog = pending ? (
    <ConfirmDialog
      open
      title={pending.title}
      affects={pending.affects}
      amount={pending.amount}
      after={pending.after}
      confirmLabel={pending.confirmLabel}
      word={pending.word}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;
  return { confirm, dialog };
}
