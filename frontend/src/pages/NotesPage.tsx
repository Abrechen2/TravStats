import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import NoteCard from "../components/notes/NoteCard";
import NoteEditorDialog from "../components/notes/NoteEditorDialog";
import { appendPage, mergeSaved, notesByDay } from "../components/notes/noteDraft";
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

  /**
   * The loaded notes — always the first `notes.length` of the server's order
   * (see `appendPage`/`mergeSaved`) — and how many the server holds in all,
   * kept in step as notes are written and deleted here.
   */
  const [timeline, setTimeline] = useState<{ notes: Note[]; total: number }>({
    notes: [],
    total: 0,
  });
  const { notes, total } = timeline;
  const complete = notes.length >= total;
  /** Every note id already in `total` — loaded from the server or written here. */
  const counted = useRef(new Set<string>());
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailure, setMoreFailure] = useState<string | null>(null);
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
      counted.current = new Set(page.notes.map((n) => n.id));
      setTimeline({ notes: page.notes, total: page.total });
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

  /** The next page, from where the loaded prefix ends. */
  const loadOlder = async (): Promise<void> => {
    setLoadingMore(true);
    setMoreFailure(null);
    try {
      const page = await notesApi.list(notes.length);
      page.notes.forEach((n) => counted.current.add(n.id));
      setTimeline((current) => ({
        notes: appendPage(current.notes, page.notes),
        total: page.total,
      }));
    } catch (err: unknown) {
      logger.error({ err }, "NotesPage: failed to load older notes");
      setMoreFailure(t(saveErrorKey(err, "notes:paging.failed")));
    } finally {
      setLoadingMore(false);
    }
  };

  const days = useMemo(() => notesByDay(notes), [notes]);

  /** A saved note replaces its old self, or joins the list — the timeline re-sorts. */
  const upsert = useCallback((saved: Note): void => {
    setTimeline((current) => {
      // New to the server's count only once: the editor reports a note again
      // after its photo, and an old-dated note may not be in the loaded list.
      const isNew = !counted.current.has(saved.id);
      counted.current.add(saved.id);
      const total = current.total + (isNew ? 1 : 0);
      return { notes: mergeSaved(current.notes, saved, current.notes.length >= total), total };
    });
  }, []);

  const confirmDelete = async (note: Note): Promise<void> => {
    setDeleting(true);
    setDeleteFailure(null);
    try {
      await notesApi.remove(note.id);
      setTimeline((current) => ({
        notes: current.notes.filter((n) => n.id !== note.id),
        total: current.total - 1,
      }));
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
        meta={!loading && !failed ? t("notes:count", { count: total }) : t("notes:subtitle")}
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

      {!loading && !failed && notes.length > 0 && (
        <div
          className="flex flex-col items-center"
          style={{ gap: "var(--ts-space-sm)", marginTop: "var(--ts-space-xl)" }}
        >
          <FormErrorBanner message={moreFailure} />
          {complete ? (
            <p className="t-caption" role="status">
              {t("notes:paging.end", { count: total })}
            </p>
          ) : (
            <>
              <p className="t-caption">{t("notes:paging.shown", { shown: notes.length, total })}</p>
              <Button onClick={() => void loadOlder()} disabled={loadingMore}>
                {loadingMore ? t("notes:paging.loading") : t("notes:paging.older")}
              </Button>
            </>
          )}
        </div>
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
