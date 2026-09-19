import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import DemoLockedNotice from "../Settings/DemoLockedNotice";
import ConfirmModal from "../Training/ConfirmModal";
import DetailSection from "../ui/DetailSection";
import { Icon } from "../ui/Icon";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import {
  documentFileUrl,
  documentsApi,
  isDemoForbidden,
  type DocumentEntryRef,
  type DocumentLimits,
  type TravelDocument,
} from "../../lib/api/documents";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { useDisplayFormat } from "../../lib/displayFormat";
import { formatBytes } from "../../lib/fileSize";
import { logger } from "../../lib/logger";
import { DOCUMENT_FORMAT_ICON, exceededDocumentLimit } from "./documentDisplay";

interface Props {
  /** Which record these documents hang off. One of the five the API serves. */
  entry: DocumentEntryRef;
  /**
   * `card` sits among the detail pages' `DetailSection` cards; `inline` is the
   * compact form for a row that is already inside a panel — a place VISIT,
   * where the documents hang off the visit rather than the place, exactly as
   * the photo strip beside them does.
   */
  layout?: "card" | "inline";
}

/**
 * The kept originals of ONE entry: list, open, add, remove.
 *
 * `backend/src/routes/documents.ts` (forgejo#116) has served these five
 * prefixes since 2026-09-16 and the Companion has used them since. The web had
 * no surface at all — a search for "/documents" under `frontend/src` found
 * nothing on 2026-09-19 — while the 2.7.0 what's-new already told users that
 * boarding passes, hotel bills and booking confirmations now sit as documents
 * on the entry they belong to. A promise in a release note with no screen
 * behind it is worse than an unfinished feature, because nobody looks for a
 * defect in something they were told exists.
 *
 * It does NOT replace the single receipt a flight or a stay already carries.
 * That one field is the "Beleg" the cost block links to; this is the whole
 * folder, and the two answer different questions.
 */
export default function DocumentsSection({ entry, layout = "card" }: Props): JSX.Element {
  const { t } = useTranslation(["documents", "common"]);
  const format = useDisplayFormat();
  const isSharedDemo = useIsDemoAccount();
  const inputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<TravelDocument[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [limits, setLimits] = useState<DocumentLimits | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A 403 the server answered with `DEMO_ACCOUNT_FORBIDDEN`. Held apart from
   * `error` because the answer is not a failure message but the standing
   * sentence — and because the control is then withdrawn rather than retried.
   */
  const [demoRefused, setDemoRefused] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TravelDocument | null>(null);

  const entryType = entry.type;
  const entryId = entry.id;

  const reload = useCallback(async (): Promise<void> => {
    try {
      setDocuments(await documentsApi.listForEntry({ type: entryType, id: entryId }));
      setLoadFailed(false);
    } catch (err: unknown) {
      logger.error({ err, entryType, entryId }, "DocumentsSection: list failed");
      setLoadFailed(true);
    }
  }, [entryType, entryId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    // The demo account may not upload at all, so the limits it would be
    // measured against are a request nobody reads.
    if (isSharedDemo) return;
    documentsApi.limits().then(setLimits, (err: unknown) => {
      // An older server answers 404 here. Not an error on screen: without the
      // numbers the upload simply goes out unchecked and the server decides.
      logger.warn({ err }, "DocumentsSection: limits unavailable");
    });
  }, [isSharedDemo]);

  const handleUpload = useCallback(
    async (file: File | undefined): Promise<void> => {
      if (!file) return;
      const broken = exceededDocumentLimit(file, limits);
      if (broken !== null) {
        setError(t("documents:tooLarge", { limit: formatBytes(broken) }));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await documentsApi.upload({ entry: { type: entryType, id: entryId }, file });
        // Re-read rather than append: the server answers a repeat of the same
        // bytes with the document already on file, so appending would show it
        // twice.
        await reload();
      } catch (err: unknown) {
        if (isDemoForbidden(err)) {
          setDemoRefused(true);
        } else {
          logger.error({ err, entryType, entryId }, "DocumentsSection: upload failed");
          setError(t("documents:uploadFailed"));
        }
      } finally {
        setBusy(false);
        // Clear the input, or picking the same file twice in a row fires no
        // change event and the second attempt silently does nothing.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [entryType, entryId, limits, reload, t]
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setBusy(true);
    try {
      await documentsApi.remove(id);
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
      setError(null);
    } catch (err: unknown) {
      if (isDemoForbidden(err)) {
        setDemoRefused(true);
      } else {
        logger.error({ err, id }, "DocumentsSection: delete failed");
        setError(t("documents:deleteFailed"));
      }
    } finally {
      // The question has been answered either way, so the dialog closes either
      // way. Leaving it open on a failure hid the message behind a modal that
      // still looked busy, and the only way out was the cancel button — which
      // reads as "the delete was cancelled" when it was refused.
      setPendingDelete(null);
      setBusy(false);
    }
  }, [pendingDelete, t]);

  const locked = isSharedDemo || demoRefused;

  const body = (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {loadFailed && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-warn)" }}>
          {t("documents:loadFailed")}
        </p>
      )}

      {/* Three states, not two. A failed load is neither "here they are" nor
          "there are none": the list is drawn only when there IS one, and the
          empty sentence only when the server actually said so. The else-branch
          alone used to draw an empty <ul> under the error line. */}
      {documents.length === 0 ? (
        loadFailed ? null : (
          <p className="t-caption">{t("documents:empty")}</p>
        )
      ) : (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex min-w-0 items-center"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <Icon
                name={DOCUMENT_FORMAT_ICON[doc.format]}
                size={16}
                label={t(`documents:format.${doc.format}`)}
                style={{ color: "var(--ts-muted)" }}
              />
              <a
                // A plain link, not a fetch: the JWT is an HttpOnly cookie and
                // a top-level navigation carries it.
                href={documentFileUrl(doc)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("documents:openLabel", { name: doc.displayName })}
                className="min-w-0 flex-1 truncate text-sm"
                style={{ color: "var(--ts-text-bright)", fontWeight: 600 }}
              >
                {doc.displayName}
              </a>
              <span className="t-caption shrink-0">
                {[
                  doc.kind ? t(`documents:kind.${doc.kind}`) : t(`documents:format.${doc.format}`),
                  formatBytes(doc.sizeBytes),
                  format.date(doc.issuedOn ?? doc.createdAt),
                ].join(" · ")}
              </span>
              {!locked && (
                <button
                  type="button"
                  onClick={() => setPendingDelete(doc)}
                  aria-label={t("documents:removeLabel", { name: doc.displayName })}
                  className="shrink-0 text-sm"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--ts-muted)",
                  }}
                >
                  {t("documents:remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}

      {locked ? (
        <DemoLockedNotice />
      ) : (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
          <label
            className="cursor-pointer rounded-md px-3 py-2 text-xs"
            style={{ border: "1px dashed var(--ts-border)", color: "var(--ts-muted)" }}
          >
            {busy ? t("documents:uploading") : `+ ${t("documents:add")}`}
            <input
              ref={inputRef}
              type="file"
              hidden
              data-testid="documents-file-input"
              disabled={busy}
              onChange={(e) => void handleUpload(e.target.files?.[0])}
            />
          </label>
          {limits && (
            <span className="t-caption">
              {t("documents:limitHint", {
                image: formatBytes(limits.image),
                pdf: formatBytes(limits.pdf),
                eml: formatBytes(limits.eml),
                emailText: formatBytes(limits.emailText),
                pkpass: formatBytes(limits.pkpass),
              })}
            </span>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void handleDelete()}
        isLoading={busy}
        title={t("documents:deleteTitle")}
        message={t("documents:deleteMessage", { name: pendingDelete?.displayName ?? "" })}
        confirmText={t("common:buttons.delete")}
        cancelText={t("common:buttons.cancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </div>
  );

  if (layout === "inline") {
    return (
      <div className="mt-2 flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <span className="t-caption">{t("documents:title")}</span>
        {body}
      </div>
    );
  }

  return <DetailSection title={t("documents:title")}>{body}</DetailSection>;
}
