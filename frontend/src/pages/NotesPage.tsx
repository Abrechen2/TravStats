import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import NoteCard from "../components/notes/NoteCard";
import NoteEditorDialog from "../components/notes/NoteEditorDialog";
import { notesByDay } from "../components/notes/noteDraft";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import { FormErrorBanner } from "../components/form";
import { AppShell, Button, Dialog, EmptyState, PageHeader } from "../components/ui";
import { useTranslation } from "../hooks/useTranslation";
import { useTodayZone } from "../hooks/useTodayZone";
import { notesApi, type Note } from "../lib/api/notes";
import { logger } from "../lib/logger";
import { saveErrorKey } from "../lib/saveErrorMessage";
import { formatDayLong } from "../shared/time";

/** Which dialog is open: the editor (null note = a new one) or the delete question. */
type Open = { kind: "edit"; note: Note | null } | { kind: "delete"; note: Note } | null;

/**
 * Standalone notes (forgejo#137): moments that belong to no trip, as a
 * timeline grouped by the day each note belongs to — the day in the zone it
 * was written in, which is the server's `times.day`, never re-derived here.
 *
 * Reached from "Mehr › Sammlungen": a note is something the user keeps, like
 * achievements or place lists, and needs no domain switched on.
 */
export default function NotesPage(): JSX.Element {
  const { t, i18n } = useTranslation(["notes", "common"]);
  const readerZone = useTodayZone();

  const [notes, setNotes] = useState<Note[]>([]);
  /** Notes on the server beyond the loaded page, so the count stays right as notes come and go. */
  const [unloaded, setUnloaded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState<Open>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadFailure(undefined);
    try {
      const page = await notesApi.list();
      setNotes(page.notes);
      setUnloaded(Math.max(0, page.total - page.notes.length));
    } catch (err: unknown) {
      logger.error({ err }, "NotesPage: failed to load notes");
      setLoadFailure(loadFailureLog(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => notesByDay(notes), [notes]);

  /** A saved note replaces its old self, or joins the list — the timeline re-sorts. */
  const upsert = useCallback((saved: Note): void => {
    setNotes((list) =>
      list.some((n) => n.id === saved.id)
        ? list.map((n) => (n.id === saved.id ? saved : n))
        : [saved, ...list]
    );
  }, []);

  const confirmDelete = async (note: Note): Promise<void> => {
    setDeleting(true);
    setDeleteFailure(null);
    try {
      await notesApi.remove(note.id);
      setNotes((list) => list.filter((n) => n.id !== note.id));
      setOpen(null);
    } catch (err: unknown) {
      logger.error({ err }, "NotesPage: failed to delete a note");
      setDeleteFailure(t(saveErrorKey(err, "notes:errors.deleteFailed")));
    } finally {
      setDeleting(false);
    }
  };

  const failed = loadFailure !== undefined;

  return (
    <AppShell width="reading">
      <PageHeader
        title={t("notes:title")}
        meta={
          !loading && !failed
            ? t("notes:count", { count: notes.length + unloaded })
            : t("notes:subtitle")
        }
        actions={
          <Button variant="primary" onClick={() => setOpen({ kind: "edit", note: null })}>
            {t("notes:new")}
          </Button>
        }
      />

      {loading && (
        <p className="t-caption py-10 text-center" role="status">
          {t("notes:loading")}
        </p>
      )}

      {failed && (
        <ListLoadFailed
          title={t("notes:loadError")}
          onRetry={() => void load()}
          log={loadFailure}
        />
      )}

      {!loading && !failed && notes.length === 0 && (
        <EmptyState
          title={t("notes:empty.title")}
          description={t("notes:empty.description")}
          action={
            <Button variant="primary" onClick={() => setOpen({ kind: "edit", note: null })}>
              {t("notes:empty.action")}
            </Button>
          }
        />
      )}

      {!loading && !failed && notes.length > 0 && (
        <ol
          className="flex flex-col"
          style={{ gap: "var(--ts-space-xl)", listStyle: "none", padding: 0 }}
        >
          {days.map(({ day, notes: dayNotes }) => (
            <li key={day}>
              <h2 className="t-label-mono" style={{ marginBottom: "var(--ts-space-sm)" }}>
                <time dateTime={day}>{formatDayLong(day, i18n.language)}</time>
              </h2>
              <ul
                className="flex flex-col"
                style={{ gap: "var(--ts-space-sm)", listStyle: "none", padding: 0 }}
              >
                {dayNotes.map((note) => (
                  <li key={note.id}>
                    <NoteCard
                      note={note}
                      readerZone={readerZone}
                      onEdit={(n) => setOpen({ kind: "edit", note: n })}
                      onDelete={(n) => {
                        setDeleteFailure(null);
                        setOpen({ kind: "delete", note: n });
                      }}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {open?.kind === "edit" && (
        <NoteEditorDialog note={open.note} onClose={() => setOpen(null)} onSaved={upsert} />
      )}

      {open?.kind === "delete" && (
        <Dialog
          open
          onClose={() => setOpen(null)}
          busy={deleting}
          title={t("notes:delete.title")}
          dismissLabel={t("notes:delete.cancel")}
          closeLabel={t("notes:editor.close")}
          action={
            <Button
              variant="danger"
              disabled={deleting}
              onClick={() => void confirmDelete(open.note)}
            >
              {t("notes:delete.confirm")}
            </Button>
          }
        >
          <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            <FormErrorBanner message={deleteFailure} />
            <p>
              {t("notes:delete.body", {
                date: formatDayLong(open.note.times.day.date, i18n.language),
              })}
            </p>
          </div>
        </Dialog>
      )}
    </AppShell>
  );
}
