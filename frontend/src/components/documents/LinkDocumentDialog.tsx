import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * Several documents at once (the inbox's multi-select): each is linked to the
   * chosen entry. Their candidates are read from `document`, so they must all be
   * unfiled — an unfiled document has no links to exclude, which makes the list
   * the same for every one of them.
   */
  documents?: TravelDocument[];
  /** One entry only (bulk link): a radio list instead of checkboxes. */
  single?: boolean;
  /**
   * The document belongs to no entry yet (the inbox): it is linked, not "also"
   * linked, so the title and hint say "Verknüpfen mit …".
   */
  unassigned?: boolean;
  onClose: () => void;
  /** After at least one link was made, so the list behind can re-read. */
  onLinked: () => void;
}

/** Typing waits this long before the server is asked. */
const SEARCH_DEBOUNCE_MS = 250;

/** The API takes at most this many links per request. */
const MAX_LINKS = 100;

const keyOf = (e: { type: string; id: string }): string => `${e.type}:${e.id}`;

/**
 * "Auch verknüpfen mit …" — on a document: a multi-select of the account's
 * entries, those sharing a trip with the document first. Links made here are
 * `covers` with provenance `user`; nothing is copied (plan D2).
 */
export default function LinkDocumentDialog({
  document,
  documents,
  single = false,
  unassigned = false,
  onClose,
  onLinked,
}: Props): JSX.Element {
  const { t } = useTranslation(["documents", "common"]);
  const targets = documents ?? [document];
  const [candidates, setCandidates] = useState<DocumentLinkCandidates | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [picked, setPicked] = useState<Map<string, DocumentEntryCandidate>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The text goes to the server: the unfiltered list is only the most recent
  // entries per type, so filtering it here could never find an older one.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchText(filter.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filter]);

  // Only the newest search may answer: a slow reply to an older text must not replace the results
  // of the one the user is looking at.
  const latestSearch = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const mine = ++latestSearch.current;
    try {
      const found = await documentsApi.linkCandidates(document.id, searchText);
      if (mine !== latestSearch.current) return;
      setCandidates(found);
      setLoadFailed(false);
    } catch (err: unknown) {
      if (mine !== latestSearch.current) return;
      logger.error({ err, id: document.id }, "LinkDocumentDialog: candidates failed");
      setLoadFailed(true);
    }
  }, [document.id, searchText]);

  useEffect(() => {
    void load();
  }, [load]);

  const tripEntries = useMemo(() => candidates?.tripEntries ?? [], [candidates]);
  const otherEntries = useMemo(() => candidates?.otherEntries ?? [], [candidates]);

  const toggle = (entry: DocumentEntryCandidate): void =>
    setPicked((prev) => {
      const next = single ? new Map<string, DocumentEntryCandidate>() : new Map(prev);
      if (prev.has(keyOf(entry))) next.delete(keyOf(entry));
      else next.set(keyOf(entry), entry);
      return next;
    });

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const links = [...picked.values()].map((e) => ({ entry: { type: e.type, id: e.id } }));
    const failed: Array<{ name: string; err: unknown }> = [];
    let linked = 0;
    // One request per document: a failure on one must not hide that the others went through.
    for (const target of targets) {
      try {
        await documentsApi.addLinks(target.id, links);
        linked += 1;
      } catch (err: unknown) {
        logger.error({ err, id: target.id }, "LinkDocumentDialog: link failed");
        failed.push({ name: target.displayName, err });
      }
    }
    setBusy(false);
    if (linked > 0) onLinked();
    if (failed.length === 0) {
      onClose();
      return;
    }
    const first = failed[0].err;
    const reason = isDemoForbidden(first)
      ? t("documents:links.errors.demo")
      : t(linkErrorKey(first));
    setError(
      targets.length > 1
        ? t("documents:links.errors.someFailed", {
            count: failed.length,
            names: failed.map((f) => f.name).join(", "),
            reason,
          })
        : reason
    );
    // The list may be stale (a duplicate, a deleted entry): re-read it, keep the picks that still exist.
    setPicked(new Map());
    void load();
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
                  type={single ? "radio" : "checkbox"}
                  name="link-entry"
                  checked={picked.has(keyOf(entry))}
                  onChange={() => toggle(entry)}
                  disabled={
                    busy || (!single && !picked.has(keyOf(entry)) && picked.size >= MAX_LINKS)
                  }
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
      title={
        targets.length > 1
          ? t("documents:links.bulkTitle", { count: targets.length })
          : t(unassigned ? "documents:links.linkTo" : "documents:links.alsoLink", {
              name: document.displayName,
            })
      }
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
            {single
              ? t("documents:links.linkDocsToEntry", { count: targets.length })
              : t("documents:links.linkSelected", { count: picked.size })}
          </button>
        </>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <p className="t-caption">
          {t(
            targets.length > 1
              ? "documents:links.bulkHint"
              : unassigned
                ? "documents:links.linkToHint"
                : "documents:links.alsoLinkHint"
          )}
        </p>
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
          <p className="t-caption">
            {t(searchText ? "documents:links.noMatches" : "documents:links.noCandidates", {
              text: searchText,
            })}
          </p>
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
