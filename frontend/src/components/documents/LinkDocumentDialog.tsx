import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import {
  documentsApi,
  isDemoForbidden,
  type DocumentEntryCandidate,
  type DocumentLinkCandidates,
  type TravelDocument,
} from "../../lib/api/documents";
import { logger } from "../../lib/logger";
import { linkErrorKey } from "./documentLinkUi";

interface Props {
  document: TravelDocument;
  onClose: () => void;
  /** After at least one link was made, so the list behind can re-read. */
  onLinked: () => void;
}

const keyOf = (e: { type: string; id: string }): string => `${e.type}:${e.id}`;

/**
 * "Auch verknüpfen mit …" — on a document: a multi-select of the account's
 * entries, those sharing a trip with the document first. Links made here are
 * `covers` with provenance `user`; nothing is copied (plan D2).
 */
export default function LinkDocumentDialog({ document, onClose, onLinked }: Props): JSX.Element {
  const { t } = useTranslation(["documents", "common"]);
  const [candidates, setCandidates] = useState<DocumentLinkCandidates | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Map<string, DocumentEntryCandidate>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setCandidates(await documentsApi.linkCandidates(document.id));
      setLoadFailed(false);
    } catch (err: unknown) {
      logger.error({ err, id: document.id }, "LinkDocumentDialog: candidates failed");
      setLoadFailed(true);
    }
  }, [document.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const matches = (e: DocumentEntryCandidate): boolean =>
    filter.trim() === "" || e.label.toLowerCase().includes(filter.trim().toLowerCase());
  const tripEntries = useMemo(
    () => (candidates?.tripEntries ?? []).filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, filter]
  );
  const otherEntries = useMemo(
    () => (candidates?.otherEntries ?? []).filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, filter]
  );

  const toggle = (entry: DocumentEntryCandidate): void =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(keyOf(entry))) next.delete(keyOf(entry));
      else next.set(keyOf(entry), entry);
      return next;
    });

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await documentsApi.addLinks(
        document.id,
        [...picked.values()].map((e) => ({ entry: { type: e.type, id: e.id } }))
      );
      onLinked();
      onClose();
    } catch (err: unknown) {
      if (isDemoForbidden(err)) setError(t("documents:links.errors.demo"));
      else {
        logger.error({ err, id: document.id }, "LinkDocumentDialog: link failed");
        setError(t(linkErrorKey(err)));
        // The list may be stale (a duplicate, a deleted entry): re-read it, keep the picks that still exist.
        setPicked(new Map());
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  const group = (title: string, entries: DocumentEntryCandidate[]): JSX.Element | null =>
    entries.length === 0 ? null : (
      <fieldset className="min-w-0" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="t-caption mb-1">{title}</legend>
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          {entries.map((entry) => (
            <li key={keyOf(entry)}>
              <label
                className="flex cursor-pointer items-center text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
                style={{ gap: "var(--ts-space-md)" }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(keyOf(entry))}
                  onChange={() => toggle(entry)}
                  disabled={busy}
                />
                <span className="t-caption shrink-0" style={{ color: "var(--ts-muted)" }}>
                  {t(`documents:links.entryType.${entry.type}`)}
                </span>
                <span className="min-w-0 truncate">{entry.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    );

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={t("documents:links.alsoLink", { name: document.displayName })}
      maxWidth={560}
      testId="link-document-dialog"
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
            {t("documents:links.linkSelected", { count: picked.size })}
          </button>
        </>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <p className="t-caption">{t("documents:links.alsoLinkHint")}</p>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("documents:links.filter")}
          aria-label={t("documents:links.filter")}
          className="rounded-md px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
          style={{ border: "1px solid var(--ts-border)", background: "transparent" }}
        />
        {loadFailed && (
          <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
            {t("documents:links.errors.candidatesFailed")}
          </p>
        )}
        {candidates && tripEntries.length + otherEntries.length === 0 && !loadFailed && (
          <p className="t-caption">{t("documents:links.noCandidates")}</p>
        )}
        {group(t("documents:links.fromTrip"), tripEntries)}
        {group(t("documents:links.otherEntries"), otherEntries)}
        {error !== null && (
          <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
