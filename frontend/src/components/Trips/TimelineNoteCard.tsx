import { useState, type JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { notePhotoSrc } from "../../lib/api/notes";
import { formatTimelineDate } from "../../lib/tripTimeline";
import { formatDayLong } from "../../shared/time";
import type { TimelineEvent } from "../../lib/tripTimelineEvents";
import { ExpandableEventCard } from "../Trip/ExpandableEventCard";

/**
 * A standalone note on a trip's timeline (forgejo#146), at its moment on the
 * clock it was written on. The reader's own note opens the note editor in
 * place; another member's shareable note is read-only and says whose it is.
 */

function headline(body: string): string {
  const firstLine = body.split("\n")[0].trim();
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 59).trimEnd()}…`;
}

const ACTION_STYLE = { border: "1px solid var(--color-border)", color: "var(--text-muted)" };

export function TimelineNoteCard({
  ev,
  onEdit,
}: {
  ev: Extract<TimelineEvent, { kind: "note" }>;
  /** Opens the editor on the reader's own note. */
  onEdit: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "notes"]);
  const [open, setOpen] = useState(false);
  const shareable = ev.mine && ev.note.visibility === "shareable";
  const subtitle = [
    ev.mine ? null : t("trips:detail.timeline.note.by", { name: ev.note.author.displayName }),
    ev.note.placeName,
    shareable ? t("notes:card.shareable") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ExpandableEventCard
      icon="🗒"
      bg="var(--ts-surface2)"
      iconColor="var(--text-muted)"
      title={headline(ev.note.body)}
      subtitle={subtitle || null}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.when)}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      detailsLabel={t("trips:detail.timeline.showDetails")}
    >
      <p
        className="text-sm"
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}
      >
        {ev.note.body}
      </p>
      {ev.mine && ev.note.photo && (
        <img
          src={notePhotoSrc(ev.note.photo)}
          alt={t("notes:card.photoAlt", {
            date: formatDayLong(ev.note.times.day.date, i18n.language),
          })}
          loading="lazy"
          className="mt-2 max-h-60 w-auto object-contain"
          style={{ borderRadius: "var(--ts-radius-card)" }}
        />
      )}
      {ev.mine ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg px-3 py-1.5 text-xs"
            style={ACTION_STYLE}
          >
            {t("notes:card.edit")}
          </button>
          <Link to="/notes" className="rounded-lg px-3 py-1.5 text-xs" style={ACTION_STYLE}>
            {t("trips:detail.timeline.note.allNotes")}
          </Link>
        </div>
      ) : (
        <p className="t-caption mt-2">{t("trips:detail.timeline.note.memberHint")}</p>
      )}
    </ExpandableEventCard>
  );
}

/** Said above the timeline when the notes could not be loaded, or were cut at the bound. */
export function TripNotesNotice({
  failed,
  truncated,
  onRetry,
}: {
  failed: boolean;
  truncated: boolean;
  onRetry: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  if (failed) {
    return (
      <div role="alert" className="t-caption mb-3 flex flex-wrap items-center gap-2">
        {t("trips:detail.timeline.note.loadFailed")}
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg px-3 py-1.5 text-xs"
          style={ACTION_STYLE}
        >
          {t("trips:detail.timeline.note.retry")}
        </button>
      </div>
    );
  }
  if (truncated) {
    return (
      <p role="status" className="t-caption mb-3">
        {t("trips:detail.timeline.note.truncated")}
      </p>
    );
  }
  return null;
}
