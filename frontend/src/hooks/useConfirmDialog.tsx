import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import ConfirmModal from "../components/Training/ConfirmModal";
import { useTranslation } from "./useTranslation";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";

export interface ConfirmRequest {
  message: string;
  /** Defaults to the generic "Bitte bestätigen". */
  title?: string;
  /** Defaults to "Bestätigen", or "Löschen" for a destructive question. */
  confirmText?: string;
  /** Red confirm button — for anything that removes data. */
  destructive?: boolean;
}

interface Pending extends ConfirmRequest {
  resolve: (answer: boolean) => void;
}

/**
 * The in-page replacement for `window.confirm`, with the same shape at the
 * call site: `if (!(await confirm({ message }))) return;`.
 *
 * The browser's own box was used in nineteen places (browser acceptance
 * 2026-09-26). Its buttons speak the browser's language, not the app's, it
 * cannot mark which answer deletes, it blocks the whole tab, and a browser
 * that suppresses dialogs answers it "no" without asking — the button then
 * does nothing, silently. The question now goes through `ConfirmModal`, the
 * dialog every other delete already uses.
 *
 * Render `confirmDialog` once in the component. An unanswered question is
 * answered "no" when the component unmounts, so no caller waits forever.
 */
export function useConfirmDialog(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** Shorthand for the common case: a destructive question with a red "Löschen". */
  confirmDelete: (message: string) => Promise<boolean>;
  confirmDialog: JSX.Element | null;
} {
  const { t } = useTranslation(["common"]);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((answer: boolean): void => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(answer);
  }, []);

  const confirm = useCallback(
    (request: ConfirmRequest): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // A second question replaces the first, which counts as declined.
        pendingRef.current?.resolve(false);
        const next = { ...request, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    []
  );

  const confirmDelete = useCallback(
    (message: string): Promise<boolean> => confirm({ message, destructive: true }),
    [confirm]
  );

  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const confirmDialog = pending ? (
    <ConfirmModal
      isOpen
      title={pending.title ?? t("common:confirmDialog.title")}
      message={pending.message}
      confirmText={
        pending.confirmText ??
        (pending.destructive ? t("common:buttons.delete") : t("common:buttons.confirm"))
      }
      cancelText={t("common:buttons.cancel")}
      confirmButtonClass={pending.destructive ? DELETE_BUTTON_CLASS : undefined}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmDelete, confirmDialog };
}
