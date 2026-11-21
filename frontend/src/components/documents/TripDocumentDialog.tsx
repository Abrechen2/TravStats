import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import {
  documentsApi,
  isDemoForbidden,
  type DocumentEntryRef,
  type TravelDocument,
} from "../../lib/api/documents";
import { logger } from "../../lib/logger";
import { linkErrorKey } from "./documentLinkUi";

interface Props {
  entry: DocumentEntryRef;
  onClose: () => void;
  onLinked: () => void;
}

/**
 * "Dokument aus der Reise verknüpfen" — on an entry: the documents of its own
 * trip it is not linked to yet. One request per document, so one that fails
 * (deleted meanwhile, already linked in another tab) is named and the others
 * still go through.
 */
export default function TripDocumentDialog({ entry, onClose, onLinked }: Props): JSX.Element {
  const { t } = useTranslation(["documents", "common"]);
  const [documents, setDocuments] = useState<TravelDocument[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setDocuments(await documentsApi.tripCandidates(entry));
      setLoadFailed(false);
    } catch (err: unknown) {
      logger.error({ err, entry }, "TripDocumentDialog: candidates failed");
      setLoadFailed(true);
    }
  }, [entry]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    let linked = 0;
    let lastKey = "documents:links.errors.failed";
    for (const id of picked) {
      try {
        await documentsApi.addLinks(id, [{ entry }]);
        linked += 1;
      } catch (err: unknown) {
        if (isDemoForbidden(err)) {
          setError(t("documents:links.errors.demo"));
          setBusy(false);
          return;
        }
        logger.error({ err, id }, "TripDocumentDialog: link failed");
        lastKey = linkErrorKey(err);
        failed.push(documents?.find((d) => d.id === id)?.displayName ?? id);
      }
    }
    setBusy(false);
    if (linked > 0) onLinked();
    if (failed.length === 0) {
      onClose();
      return;
    }
    setError(`${t(lastKey)} (${failed.join(", ")})`);
    setPicked(new Set());
    void load();
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={t("documents:links.fromTripAction")}
      maxWidth={560}
      testId="trip-document-dialog"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex justify-center rounded-md border border-border px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min) disabled:opacity-50"
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || picked.size === 0}
            className="btn-primary inline-flex justify-center rounded-md px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min) disabled:opacity-50"
          >
            {t("documents:links.linkSelectedDocs", { count: picked.size })}
          </button>
        </>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {loadFailed && (
          <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
            {t("documents:links.errors.candidatesFailed")}
          </p>
        )}
        {documents && documents.length === 0 && !loadFailed && (
          <p className="t-caption">{t("documents:links.noTripDocuments")}</p>
        )}
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          {(documents ?? []).map((doc) => (
            <li key={doc.id}>
              <label
                className="flex cursor-pointer items-center text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
                style={{ gap: "var(--ts-space-md)" }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(doc.id)}
                  disabled={busy}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(doc.id)) next.delete(doc.id);
                      else next.add(doc.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 truncate">{doc.displayName}</span>
              </label>
            </li>
          ))}
        </ul>
        {error !== null && (
          <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
