import { useId, useState, type JSX, type ReactNode } from "react";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";

interface ConsentCheckDialogProps {
  title: string;
  /** What the person agrees to, as read-only facts above the checkbox. */
  children: ReactNode;
  checkboxLabel: string;
  confirmLabel: string;
  busy: boolean;
  /** A failed confirm is said here, in the dialog, not in a toast behind it. */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The data-sharing confirmation, admin and account alike.
 *
 * The button stays disabled until the box is ticked: leaving the dialog or
 * pressing Enter must not be a way to consent. The state lives in here, so every
 * opening starts unticked.
 */
export default function ConsentCheckDialog({
  title,
  children,
  checkboxLabel,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: ConsentCheckDialogProps): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const [checked, setChecked] = useState(false);
  const id = useId();
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      busy={busy}
      maxWidth={560}
      dismissLabel={t("externalServices:actions.cancel")}
      closeLabel={t("externalServices:actions.close")}
      action={
        <Button variant="primary" disabled={!checked || busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        {children}
        <label
          htmlFor={id}
          className="flex items-start"
          style={{ gap: "var(--ts-space-md)", cursor: "pointer" }}
        >
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }}
          />
          <span>{checkboxLabel}</span>
        </label>
        {error ? (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
