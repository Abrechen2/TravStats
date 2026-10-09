import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/** Marks the banner so `focusFirstError` can fall back to it — the attribute rendered below. */
export const FORM_ERROR_BANNER_ATTR = "data-form-error-banner";

/**
 * A form's error that belongs to no single field — the server refused, the
 * network dropped — said INSIDE the form (forgejo#246).
 *
 * Not a toast: a toast disappears while the form is still wrong, and the place
 * form said "Speichern fehlgeschlagen" only that way. Not a plain red `<p>`
 * either: the lodging and cruise banners had no role, so a screen reader never
 * heard that the save had failed at all.
 *
 * It stays until the form decides otherwise — the convention is "until the
 * next edit", which the form implements by clearing its error when the draft
 * changes. `onRetry` adds a "Erneut versuchen" button for failures where
 * trying again is the likely fix (network, an unavailable database).
 *
 * `tabIndex={-1}` so `focusFirstError` can move focus here when no field is
 * at fault.
 */
export default function FormErrorBanner({
  message,
  onRetry,
  retryDisabled = false,
}: {
  message: string | null | undefined;
  onRetry?: () => void;
  retryDisabled?: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  if (!message) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      data-form-error-banner=""
      className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="rounded-md border border-[var(--danger)]/50 px-3 py-1 text-sm disabled:opacity-50"
        >
          {t("common:buttons.retry")}
        </button>
      )}
    </div>
  );
}
