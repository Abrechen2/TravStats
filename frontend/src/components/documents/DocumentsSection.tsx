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
  type RentalDocumentCategory,
  type TravelDocument,
} from "../../lib/api/documents";
import { RentalCategorySelect, groupByRentalCategory } from "./rentalCategories";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { useDisplayFormat, type DisplayFormatter } from "../../lib/displayFormat";
import { formatBytes } from "../../lib/fileSize";
import { logger } from "../../lib/logger";
import type { ExtractTarget } from "../../lib/extractValues";
import { DOCUMENT_FORMAT_ICON, exceededDocumentLimit } from "./documentDisplay";
import { ExtractValuesAction } from "./ExtractValuesAction";

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
  /**
   * Where "take the values from this document" writes. Absent for an entry
   * with no cost block (a trip, a place visit), and then no row offers it.
   */
  extract?: ExtractTarget;
  /**
   * A rental's evidence (forgejo#239): the list is grouped by what each
   * document shows, each row can be re-filed, and an upload can be filed
   * under a category at once. Only for a `rentalBooking` entry.
   */
  rentalCategories?: boolean;
}

/** The formats the text parsers read; an image or a wallet pass is not offered. */
const EXTRACTABLE = new Set(["pdf", "eml", "emailText"]);

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
/**
 * The date a row prints: the day written on the document, or failing that the
 * day it was kept.
 *
 * `issuedOn` is date-only ("2026-09-18") — a DATE, not an instant. Read as one
 * it is UTC midnight, and every viewer west of Greenwich sees the day before
 * the one on the bill. `createdAt` is a real timestamp and belongs in the
 * viewer's own zone, so the two are NOT formatted the same way. Same rule and
 * same fix as `Stats/RecordsSection.tsx`.
 */
function issuedOrCreated(document: TravelDocument, format: DisplayFormatter): string {
  return document.issuedOn
    ? format.date(`${document.issuedOn}T00:00:00Z`, { timeZone: "UTC" })
    : format.date(document.createdAt);
}

export default function DocumentsSection({
  entry,
  layout = "card",
  extract,
  rentalCategories = false,
}: Props): JSX.Element {
  const { t } = useTranslation(["documents", "common"]);
  const format = useDisplayFormat();
  const isSharedDemo = useIsDemoAccount();
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Whether the list has been asked for at all.
   *
   * A card stands alone on a detail page and opens with it. The inline form is
   * drawn once per VISIT, and a place with six visits meant six list requests
   * and six empty sentences before anyone had shown an interest in any of
   * them — so it waits for the reader to ask. Deliberately NO count on the
   * closed affordance: a count is the very request being deferred.
   */
  const [open, setOpen] = useState<boolean>(layout === "card");
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
  /** The category the next upload is filed under (rental evidence only). */
  const [uploadCategory, setUploadCategory] = useState<RentalDocumentCategory | null>(null);
  /** A remark about the last upload that is not a failure. */
  const [notice, setNotice] = useState<string | null>(null);

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
    if (!open) return;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    // The demo account may not upload at all, so the limits it would be
    // measured against are a request nobody reads.
    if (!open || isSharedDemo) return;
    documentsApi.limits().then(setLimits, (err: unknown) => {
      // An older server answers 404 here. Not an error on screen: without the
      // numbers the upload simply goes out unchecked and the server decides.
      logger.warn({ err }, "DocumentsSection: limits unavailable");
    });
  }, [open, isSharedDemo]);

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
      setNotice(null);
      try {
        const kept = await documentsApi.upload({
          entry: { type: entryType, id: entryId },
          file,
          ...(rentalCategories && uploadCategory ? { rentalCategory: uploadCategory } : {}),
        });
        // The same file was already filed under another category: the server
        // keeps that one, and the section says so (review, minor 4).
        if (
          rentalCategories &&
          uploadCategory &&
          kept.rentalCategory &&
          kept.rentalCategory !== uploadCategory
        ) {
          setNotice(
            t("documents:rentalCategory.alreadyFiled", {
              name: kept.displayName,
              category: t(`documents:rentalCategory.${kept.rentalCategory}`),
            })
          );
        }
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
    [entryType, entryId, limits, reload, t, rentalCategories, uploadCategory]
  );

  // Re-filing changes a label on the same document; the answer is the truth.
  const handleCategory = useCallback(
    async (doc: TravelDocument, next: RentalDocumentCategory | null): Promise<void> => {
      setBusy(true);
      try {
        const saved = await documentsApi.setRentalCategory(doc.id, next);
        setDocuments((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
        setError(null);
      } catch (err: unknown) {
        if (isDemoForbidden(err)) {
          setDemoRefused(true);
        } else {
          logger.error({ err, id: doc.id }, "DocumentsSection: category change failed");
          setError(t("documents:rentalCategory.saveFailed"));
        }
      } finally {
        setBusy(false);
      }
    },
    [t]
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

  const renderRow = (doc: TravelDocument): JSX.Element => (
    <li key={doc.id} className="flex min-w-0 items-center" style={{ gap: "var(--ts-space-md)" }}>
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
          issuedOrCreated(doc, format),
        ].join(" · ")}
      </span>
      {extract && !locked && EXTRACTABLE.has(doc.format) && (
        <ExtractValuesAction documentId={doc.id} target={extract} />
      )}
      {rentalCategories && !locked && (
        <RentalCategorySelect
          id={`document-category-${doc.id}`}
          label={t("documents:rentalCategory.rowLabel", { name: doc.displayName })}
          value={doc.rentalCategory ?? null}
          disabled={busy}
          onChange={(next) => void handleCategory(doc, next)}
        />
      )}
      {!locked && (
        <button
          type="button"
          onClick={() => setPendingDelete(doc)}
          aria-label={t("documents:removeLabel", { name: doc.displayName })}
          // A finger-sized target beside the category select (review, minor 10).
          className="shrink-0 text-sm pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:px-2"
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
  );

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
      ) : rentalCategories ? (
        groupByRentalCategory(documents).map((group) => (
          <section
            key={group.category ?? "none"}
            aria-label={t(`documents:rentalCategory.${group.category ?? "none"}`)}
          >
            <h3
              className="t-caption mb-1"
              data-testid={`documents-group-${group.category ?? "none"}`}
            >
              {t(`documents:rentalCategory.${group.category ?? "none"}`)}
            </h3>
            <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
              {group.documents.map(renderRow)}
            </ul>
          </section>
        ))
      ) : (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {documents.map(renderRow)}
        </ul>
      )}

      {notice !== null && (
        <p className="t-caption" role="status" data-testid="documents-notice">
          {notice}
        </p>
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
          {rentalCategories && (
            <span className="flex items-center gap-2 text-xs">
              <label htmlFor="document-upload-category">
                {t("documents:rentalCategory.uploadLabel")}
              </label>
              <RentalCategorySelect
                id="document-upload-category"
                label={t("documents:rentalCategory.uploadLabel")}
                value={uploadCategory}
                disabled={busy}
                onChange={setUploadCategory}
              />
            </span>
          )}
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
          {limits && layout === "card" && (
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
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="t-caption flex w-fit items-center"
          style={{
            gap: "var(--ts-space-xs)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          {t("documents:title")}
        </button>
        {open ? body : null}
      </div>
    );
  }

  return <DetailSection title={t("documents:title")}>{body}</DetailSection>;
}
