import Modal from "../Modal";
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
  const { t } = useTranslation(["trips", "common"]);
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
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5 text-lg leading-none">
            📝
          </span>
          <span className="min-w-0">
            <span className="block wrap-break-word">{heading}</span>
            {entry.title?.trim() && dateLabel && (
              <span
                className="mt-0.5 block text-xs font-normal"
                style={{ color: "var(--text-muted)" }}
              >
                {dateLabel}
              </span>
            )}
            {meta && (
              <span
                className="mt-0.5 block text-xs font-normal"
                style={{ color: "var(--text-muted)" }}
              >
                {meta}
              </span>
            )}
          </span>
        </span>
      }
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              {t("trips:journalView.edit")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base)"
          >
            {t("trips:journalView.close")}
          </button>
        </>
      }
    >
      <div className="trip-markdown">
        <ReactMarkdown components={MARKDOWN_COMPONENTS}>{entry.body}</ReactMarkdown>
      </div>
    </Modal>
  );
}
