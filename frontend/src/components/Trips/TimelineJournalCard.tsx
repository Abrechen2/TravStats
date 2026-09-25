import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatObservedWeather } from "../../lib/observedWeather";
import { stripMarkdown } from "../../lib/markdownPreview";
import { formatTimelineDate } from "../../lib/tripTimeline";
import { ExpandableEventCard } from "../Trip/ExpandableEventCard";
import JournalBody from "./JournalBody";
import JournalPhotoRow from "./JournalPhotoRow";
import type { TimelineEvent } from "../../pages/TripDetailPage";

/**
 * The diary entry and the small action strip a trip's timeline draws.
 *
 * Extracted from `TripDetailPage.tsx` on 2026-09-21: that file was already
 * past the file-size ratchet's recorded length, and making the entry
 * expandable added to it. Nothing here changed in the move.
 */

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1).trimEnd() + "…";
}

export function JournalCard({
  ev,
  language,
  onView,
  onEdit,
  onDelete,
}: {
  ev: Extract<TimelineEvent, { kind: "journal" }>;
  language: string | undefined;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t } = useTranslation(["trips", "common", "openData"]);
  const [open, setOpen] = useState(false);
  const e = ev.entry;
  // The headline is a single short line, so Markdown is stripped rather than
  // rendered there; the body below it renders (issue #231).
  const headline = e.title ?? truncate(stripMarkdown(e.body), 50);
  const observed = e.observedWeather ? formatObservedWeather(e.observedWeather, t, language) : null;
  const meta = [e.weather, observed, e.mood].filter(Boolean).join(" · ") || undefined;

  /* Opens in place, like a flight and a cruise on this same timeline.
     It used to be the only entry whose full text lived behind a 11px eye
     glyph in the row's action strip — "das winzig kleine Auge" (Alex,
     2026-09-20) — while the two entries above it opened with a click on the
     header. One timeline, one way to read an entry.

     The modal stays and keeps its own place: the panel renders the body,
     the modal renders the body plus everything around it, and "Ganz öffnen"
     inside the panel is how you get there. Edit and delete moved into the
     panel too, as SIBLINGS of the toggle — never children of it, see the
     note in ExpandableEventCard. */
  return (
    <ExpandableEventCard
      icon="📝"
      bg="rgba(96,165,250,0.15)"
      /* The same blue the timeline's own dot uses for a diary entry
         (`dotColor` in TripDetailPage). Read from the token layer rather
         than repeated as a literal: a second copy of a colour is a second
         colour, as soon as one of them is adjusted. */
      iconColor="var(--ts-info)"
      title={headline}
      subtitle={meta ?? null}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.date, language)}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      detailsLabel={t("trips:detail.timeline.showDetails")}
    >
      <JournalBody body={e.body} />
      <JournalPhotoRow photos={e.photos ?? []} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onView}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
        >
          {t("trips:detail.timeline.openJournal")}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{ border: "1px solid var(--color-border)", color: "var(--text-muted)" }}
        >
          {t("common:buttons.edit")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{ border: "1px solid var(--color-border)", color: "var(--text-muted)" }}
        >
          {t("common:buttons.delete")}
        </button>
      </div>
    </ExpandableEventCard>
  );
}

export function RowActions({
  onView,
  onEdit,
  onDelete,
}: {
  onView?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <div className="flex gap-1 mt-1">
      {onView && (
        <button
          type="button"
          onClick={onView}
          className="text-[11px] px-1.5 py-0.5 rounded-sm"
          style={{ color: "var(--text-muted)" }}
          aria-label={t("common:accessibility.view")}
          title="view"
        >
          👁
        </button>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="text-[11px] px-1.5 py-0.5 rounded-sm"
        style={{ color: "var(--text-muted)" }}
        aria-label={t("common:buttons.edit")}
        title="edit"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="text-[11px] px-1.5 py-0.5 rounded-sm"
        style={{ color: "var(--danger)" }}
        aria-label={t("common:buttons.delete")}
        title="delete"
      >
        ✕
      </button>
    </div>
  );
}
