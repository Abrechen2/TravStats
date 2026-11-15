import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  saving: { saving: boolean; saved: unknown; afterSaveFailed: boolean; afterSaveFailedKey: string };
  checking: boolean;
  onClose: () => void;
  requestClose: () => void;
  onRequestDelete?: () => void;
  submit: () => Promise<void>;
}

/** The dialog's buttons — or, once stored but the follow-up failed, only "close". */
export function StayEditorFooter({
  saving,
  checking,
  onClose,
  requestClose,
  onRequestDelete,
  submit,
}: Props): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  return (
    // Stored, but the follow-up failed: the only honest action left is to
    // close. Another "Speichern" would send nothing (`useSaveOnce`), and
    // a button that does nothing is worse than no button.
    saving.afterSaveFailed ? (
      <>
        <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
          {t(saving.afterSaveFailedKey)}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
        >
          {t("common:buttons.close")}
        </button>
      </>
    ) : (
      <>
        {/* Left of the pair, and outlined rather than filled: it sits in the
                same row as Save without competing with it. The caller asks the
                question - this button only opens it. */}
        {onRequestDelete && (
          <button
            type="button"
            data-testid="stay-editor-delete"
            onClick={onRequestDelete}
            disabled={saving.saving}
            className="mr-auto rounded-md border border-[var(--danger)]/50 px-4 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
          >
            {t("common:buttons.delete")}
          </button>
        )}
        <button
          type="button"
          onClick={requestClose}
          disabled={saving.saving}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
        >
          {t("common:buttons.cancel")}
        </button>
        <button
          type="button"
          data-testid="stay-editor-save"
          onClick={(): void => {
            void submit();
          }}
          disabled={saving.saving || saving.saved !== null || checking}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
        >
          {saving.saving ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
      </>
    )
  );
}
