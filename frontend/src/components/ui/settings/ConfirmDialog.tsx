import { useEffect, useId, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import ConfirmModal from "../ConfirmModal";
import { DELETE_BUTTON_CLASS } from "../../../lib/deleteConfirm";
import { Input } from "../Field";

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Betrifft: what the action touches. */
  affects: ReactNode;
  /** Wie viel: how much of it. */
  amount: ReactNode;
  /** Danach: what is true afterwards. */
  after: ReactNode;
  /** The danger button. It names the amount: "312 Einträge ersetzen", never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Typed to enable the button; compared ignoring case and surrounding space. */
  word?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * B9: the one confirmation for everything dangerous (settings rebuild) — the
 * structured body (affects, amount, afterwards, a typed word) on top of
 * `ConfirmModal`, which owns the frame, the two buttons and the red confirm.
 *
 * Affects · how much · afterwards, then a button that names the amount. The
 * keyboard contract is the design's: the focus trap and Escape come from the
 * shared dialog shell, focus STARTS on "Abbrechen" (a stray Enter must not
 * destroy anything), and focus returns to the opener. A typed word keeps the
 * button off until it matches — with no error text, the button is the answer.
 */
export default function ConfirmDialog({
  open,
  title,
  affects,
  amount,
  after,
  confirmLabel,
  cancelLabel,
  word,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const [typed, setTyped] = useState("");
  const inputId = useId();

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const wordOk = !word || typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();

  return (
    <ConfirmModal
      isOpen={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      title={typeof title === "string" ? title : ""}
      titleNode={title}
      isLoading={busy}
      confirmDisabled={!wordOk}
      focusCancel
      confirmText={confirmLabel}
      confirmButtonClass={DELETE_BUTTON_CLASS}
      cancelText={cancelLabel ?? t("settings:blocks.confirm.cancel")}
      closeLabel={t("settings:blocks.confirm.close")}
    >
      <dl className="flex flex-col" style={{ gap: "var(--ts-space-md)", margin: 0 }}>
        {(
          [
            ["affects", affects],
            ["amount", amount],
            ["after", after],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="flex flex-col" style={{ gap: 2 }}>
            <dt
              className="t-caption"
              style={{ textTransform: "uppercase", letterSpacing: "0.6px" }}
            >
              {t(`settings:blocks.confirm.${key}`)}
            </dt>
            <dd style={{ margin: 0, color: "var(--ts-text-bright)" }}>{value}</dd>
          </div>
        ))}
      </dl>
      {word ? (
        <div
          className="flex flex-col"
          style={{ gap: "var(--ts-space-xs)", marginTop: "var(--ts-space-lg)" }}
        >
          <label htmlFor={inputId} className="t-caption">
            {t("settings:blocks.confirm.typeWord", { word })}
          </label>
          <Input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>
      ) : null}
    </ConfirmModal>
  );
}
