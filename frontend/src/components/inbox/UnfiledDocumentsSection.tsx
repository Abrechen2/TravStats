import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  documentsApi,
  isDemoForbidden,
  type UnfiledDocument,
  type UnfiledDocuments,
} from "../../lib/api/documents";
import { logger } from "../../lib/logger";
import LinkDocumentDialog from "../documents/LinkDocumentDialog";
import ConfirmModal from "../ui/ConfirmModal";
import { Card } from "../ui/Card";
import CreateFromDocumentDialog from "./unfiled/CreateFromDocumentDialog";
import DocumentPreviewModal from "./unfiled/DocumentPreviewModal";
import EditDocumentDialog from "./unfiled/EditDocumentDialog";
import UnfiledDocumentRow from "./unfiled/UnfiledDocumentRow";
import { useDocumentUpload } from "./unfiled/useDocumentUpload";

type LoadState = "loading" | "ok" | "failed";

/**
 * "These uploads belong to nothing yet, and here is when they go" — the
 * per-user block in the inbox's review tab, and the place to do something about
 * it: open, rename, link to entries (one or many), create an entry from the
 * document, delete, select several, and add a document straight into the list.
 *
 * An unfiled document is deleted by the hourly sweep, row and bytes. That was
 * true at seven days and NOTHING said so: no screen, no locale string, no
 * endpoint (2026-09-19 integrity audit, finding 4). The TTL is thirty days now,
 * and this block is the announcement — raising the number without saying it
 * would only have made the silence last longer.
 *
 * It no longer disappears when empty: the list is also where an upload lands, so
 * the empty state explains what it is. A list that FAILED to load says so with a
 * retry instead — "nothing here" and "could not ask" are different answers.
 *
 * "Öffnen" shows the document in a viewer (image or PDF inline) with a download
 * link; the bytes come from the file route as a plain URL, because the JWT is an
 * HttpOnly cookie that a navigation carries.
 */
export default function UnfiledDocumentsSection(): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common", "documents"]);
  const [unfiled, setUnfiled] = useState<UnfiledDocuments>({ ttlDays: 0, documents: [] });
  const [state, setState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<UnfiledDocument | null>(null);
  const [editing, setEditing] = useState<UnfiledDocument | null>(null);
  const [creating, setCreating] = useState<UnfiledDocument | null>(null);
  const [linking, setLinking] = useState<UnfiledDocument[] | null>(null);
  const [deleting, setDeleting] = useState<UnfiledDocument[] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await documentsApi.listUnfiled();
      setUnfiled(next);
      // Selection follows the list: a document that left it cannot stay selected.
      setSelected(
        (prev) => new Set([...prev].filter((id) => next.documents.some((d) => d.id === id)))
      );
      setState("ok");
    } catch (err: unknown) {
      logger.error({ err }, "UnfiledDocumentsSection: list failed");
      setState("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { upload, busy: uploading, errors: uploadErrors, repeats } = useDocumentUpload(load);

  const documents = unfiled.documents;
  const chosen = documents.filter((d) => selected.has(d.id));

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = async (list: UnfiledDocument[]): Promise<void> => {
    setDeleteBusy(true);
    const failed: string[] = [];
    // One by one: a document that is already gone must not stop the others.
    for (const doc of list) {
      try {
        await documentsApi.remove(doc.id);
      } catch (err: unknown) {
        logger.error({ err, id: doc.id }, "UnfiledDocumentsSection: delete failed");
        failed.push(
          `${doc.displayName}: ${
            isDemoForbidden(err)
              ? t("dataQuality:unfiledDocuments.errors.demo")
              : t("documents:deleteFailed")
          }`
        );
      }
    }
    setProblems(failed);
    setDeleteBusy(false);
    setDeleting(null);
    await load();
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    void upload(Array.from(event.dataTransfer.files));
  };

  const addButton = (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn-primary inline-flex justify-center rounded-md px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min) disabled:opacity-50"
      >
        {uploading ? t("documents:uploading") : t("documents:add")}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        data-testid="unfiled-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared, or picking the same file twice in a row fires no change event.
          e.target.value = "";
          void upload(files);
        }}
      />
    </>
  );

  return (
    <Card
      style={{
        marginBottom: "var(--ts-space-xl)",
        outline: dragging ? "2px dashed var(--ts-accent)" : undefined,
      }}
      aria-labelledby="unfiled-documents-title"
      data-testid="unfiled-documents"
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div
        className="flex flex-wrap items-start justify-between"
        style={{ gap: "var(--ts-space-md)" }}
      >
        <div className="min-w-0 flex-1" style={{ flexBasis: 320 }}>
          <h3
            id="unfiled-documents-title"
            style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
          >
            {t("dataQuality:unfiledDocuments.title")}
          </h3>
          <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
            {/* The number of days comes from the server, not from the locale file:
                the sentence names it, and a hand-written "30" would go on saying 30
                in both languages after UNLINKED_TTL_DAYS changed. */}
            {documents.length > 0
              ? t("dataQuality:unfiledDocuments.description", { days: unfiled.ttlDays })
              : t("dataQuality:unfiledDocuments.empty.body")}
          </p>
        </div>
        {addButton}
      </div>

      {state === "failed" && (
        <p
          role="alert"
          className="flex flex-wrap items-center"
          style={{
            gap: "var(--ts-space-md)",
            marginTop: "var(--ts-space-md)",
            color: "var(--ts-bad)",
          }}
        >
          {t("dataQuality:unfiledDocuments.errors.loadFailed")}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
          >
            {t("common:buttons.retry")}
          </button>
        </p>
      )}
      {[...uploadErrors, ...problems].length > 0 && (
        <ul role="alert" style={{ marginTop: "var(--ts-space-md)", color: "var(--ts-bad)" }}>
          {[...uploadErrors, ...problems].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {repeats.names.length > 0 && (
        <ul role="status" data-testid="unfiled-repeats" style={{ marginTop: "var(--ts-space-md)" }}>
          {repeats.names.map((name) => (
            <li key={name} className="text-sm" style={{ fontWeight: 600 }}>
              {`${name}: ${t("dataQuality:unfiledDocuments.alreadyThere")}`}
            </li>
          ))}
        </ul>
      )}

      {state === "ok" && documents.length === 0 && (
        <div
          data-testid="unfiled-empty"
          style={{
            marginTop: "var(--ts-space-lg)",
            padding: "var(--ts-space-xl)",
            border: "1px dashed var(--ts-border)",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <strong>{t("dataQuality:unfiledDocuments.empty.title")}</strong>
          <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
            {t("dataQuality:unfiledDocuments.empty.drop")}
          </p>
        </div>
      )}

      {chosen.length > 0 && (
        <div
          role="toolbar"
          aria-label={t("dataQuality:unfiledDocuments.bulk.label")}
          className="flex flex-wrap items-center"
          style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
        >
          <span className="t-caption">
            {t("dataQuality:unfiledDocuments.bulk.selected", { count: chosen.length })}
          </span>
          <button
            type="button"
            onClick={() => setLinking(chosen)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("dataQuality:unfiledDocuments.bulk.link")}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("dataQuality:unfiledDocuments.bulk.clear")}
          </button>
          <button
            type="button"
            onClick={() => setDeleting(chosen)}
            className="rounded-md px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
            style={{ border: "1px solid var(--ts-bad)", color: "var(--ts-bad)" }}
          >
            {t("dataQuality:unfiledDocuments.bulk.delete")}
          </button>
        </div>
      )}

      {documents.length > 0 && (
        <ul
          className="flex flex-col"
          style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
        >
          {documents.map((document) => (
            <UnfiledDocumentRow
              key={document.id}
              document={document}
              selected={selected.has(document.id)}
              highlighted={repeats.ids.includes(document.id)}
              onToggle={() => toggle(document.id)}
              onPreview={() => setPreview(document)}
              onLink={() => setLinking([document])}
              onEdit={() => setEditing(document)}
              onCreate={() => setCreating(document)}
              onDelete={() => void remove([document])}
            />
          ))}
        </ul>
      )}

      {preview && <DocumentPreviewModal document={preview} onClose={() => setPreview(null)} />}
      {editing && (
        <EditDocumentDialog
          document={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
      {creating && (
        <CreateFromDocumentDialog document={creating} onClose={() => setCreating(null)} />
      )}
      {linking && (
        <LinkDocumentDialog
          document={linking[0]}
          documents={linking}
          single={linking.length > 1}
          unassigned
          onClose={() => setLinking(null)}
          onLinked={() => void load()}
        />
      )}
      <ConfirmModal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove(deleting ?? [])}
        isLoading={deleteBusy}
        title={t("dataQuality:unfiledDocuments.delete.bulkTitle", { count: deleting?.length ?? 0 })}
        message={t("dataQuality:unfiledDocuments.delete.bulkMessage", {
          count: deleting?.length ?? 0,
        })}
        confirmText={t("dataQuality:unfiledDocuments.actions.delete")}
        confirmButtonClass="btn-danger"
      />
    </Card>
  );
}
