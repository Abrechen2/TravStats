import Modal from "../Modal";
import { useMemo } from "react";
import type { TripJournalEntry } from "../../types";
import JournalBody from "./JournalBody";
import JournalPhotoRow from "./JournalPhotoRow";
import { useTranslation } from "../../hooks/useTranslation";
import { formatObservedWeather } from "../../lib/observedWeather";
import { useLocale } from "../../hooks/useLocale";

interface JournalViewModalProps {
  entry: TripJournalEntry;
  onClose: () => void;
  /** Optional jump-to-edit affordance (closes this modal, opens the editor). */
  onEdit?: () => void;
}

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
  const { t } = useTranslation(["trips", "common", "openData"]);
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
  // The author's own words first; the measured day beside them, not instead.
  const observed = entry.observedWeather
    ? formatObservedWeather(entry.observedWeather, t, locale)
    : null;
  const meta = [entry.weather, observed, entry.mood].filter(Boolean).join(" · ");

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
                title={
                  entry.observedWeather
                    ? `${t("openData:weather.measuredAt", { place: entry.observedWeather.place })} · ${t("openData:weather.source")}`
                    : undefined
                }
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
      <JournalBody body={entry.body} />
      <JournalPhotoRow photos={entry.photos ?? []} size={120} />
    </Modal>
  );
}
