import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import Button from "../Button";
import Dialog from "../Dialog";
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
 * B9: the one confirmation for everything dangerous (settings rebuild).
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const inputId = useId();

  useEffect(() => {
    if (!open) return;
    setTyped("");
    // After the shell has given the panel focus.
    cancelRef.current?.focus();
  }, [open]);

  const wordOk = !word || typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      busy={busy}
      closeLabel={t("settings:blocks.confirm.close")}
      action={
        <>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="ts-button"
            data-variant="secondary"
            style={{
              height: "var(--ts-size-button-secondary)",
              padding: "0 var(--ts-space-xl)",
              borderRadius: "var(--ts-radius-button)",
              border: "1px solid var(--ts-border-button)",
              background: "transparent",
              color: "var(--ts-text)",
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            {cancelLabel ?? t("settings:blocks.confirm.cancel")}
          </button>
          <Button variant="danger" onClick={onConfirm} disabled={!wordOk || busy}>
            {confirmLabel}
          </Button>
        </>
      }
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
    </Dialog>
  );
}
