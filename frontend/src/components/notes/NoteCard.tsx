import type { JSX } from "react";

import { Card, IconButton } from "../ui";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { notePhotoSrc, type Note } from "../../lib/api/notes";
import { displayParts, formatDayLong } from "../../shared/time";

interface NoteCardProps {
  note: Note;
  /** The zone the reader's "today" is in; a note written elsewhere says where. */
  readerZone: string;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
}

/**
 * One note in the timeline. Its time is the clock of the zone it was written
 * in (`times.occurredAt.local`), shown as sent — the browser computes no zone.
 */
export default function NoteCard({
  note,
  readerZone,
  onEdit,
  onDelete,
}: NoteCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["notes"]);
  const parts = displayParts(note.times.occurredAt);
  const dayWords = formatDayLong(note.times.day.date, i18n.language);

  return (
    <Card style={{ padding: "var(--ts-space-lg)" }} data-testid="note-card">
      <article className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <header className="flex items-start justify-between" style={{ gap: "var(--ts-space-sm)" }}>
          <div
            className="t-caption flex flex-wrap items-center"
            style={{ gap: "var(--ts-space-sm)" }}
          >
            {parts?.time && (
              <time dateTime={note.times.occurredAt.utc} className="t-mono">
                {parts.time}
              </time>
            )}
            {note.placeName && (
              <span className="inline-flex items-center" style={{ gap: "var(--ts-space-xs)" }}>
                <Icon name="map-pin" size={14} />
                {note.placeName}
              </span>
            )}
            {note.occurredZone !== readerZone && (
              <span>{t("notes:card.writtenIn", { zone: note.occurredZone })}</span>
            )}
            {note.visibility === "shareable" && (
              <span className="inline-flex items-center" style={{ gap: "var(--ts-space-xs)" }}>
                <Icon name="link-2" size={14} />
                {t("notes:card.shareable")}
              </span>
            )}
          </div>
          <div className="flex shrink-0">
            <IconButton label={t("notes:card.edit")} onClick={() => onEdit(note)}>
              <Icon name="pencil" size={16} />
            </IconButton>
            <IconButton label={t("notes:card.delete")} onClick={() => onDelete(note)}>
              <Icon name="x" size={16} />
            </IconButton>
          </div>
        </header>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{note.body}</p>
        {note.photo && (
          <img
            src={notePhotoSrc(note.photo)}
            alt={t("notes:card.photoAlt", { date: dayWords })}
            loading="lazy"
            className="max-h-72 w-auto self-start object-contain"
            style={{ borderRadius: "var(--ts-radius-card)" }}
          />
        )}
      </article>
    </Card>
  );
}
