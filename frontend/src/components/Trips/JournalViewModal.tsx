import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { TripJournalEntry } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useLocale } from "../../hooks/useLocale";

interface JournalViewModalProps {
  entry: TripJournalEntry;
  onClose: () => void;
  /** Optional jump-to-edit affordance (closes this modal, opens the editor). */
  onEdit?: () => void;
}

// Links inside a diary entry are user-authored — open them in a new tab and
// sever the opener reference so the target page can't reach back into the app.
// (react-markdown already sanitizes javascript: URLs by default.)
const MARKDOWN_COMPONENTS: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/**
 * Read-only view of a single trip journal entry with its body rendered as
 * Markdown. The timeline card only shows a truncated plain-text preview and the
 * full text was previously reachable only through the edit modal (issue #158).
 */
export default function JournalViewModal({
  entry,
  onClose,
  onEdit,
}: JournalViewModalProps): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const locale = useLocale();

  const dateLabel = useMemo(() => {
    const d = new Date(entry.date);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }, [entry.date, locale]);

  const heading = entry.title?.trim() || dateLabel || t("trips:journalView.untitled");
  const meta = [entry.weather, entry.mood].filter(Boolean).join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-start gap-2">
            <span aria-hidden className="text-lg leading-none mt-0.5">
              📝
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold wrap-break-word">{heading}</h2>
              {entry.title?.trim() && dateLabel && (
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {dateLabel}
                </p>
              )}
              {meta && (
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {meta}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 overflow-y-auto trip-markdown">
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{entry.body}</ReactMarkdown>
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              {t("trips:journalView.edit")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base)"
          >
            {t("trips:journalView.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
