import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  documentLinkSuggestionsApi,
  type DocumentLinkSuggestion,
} from "../../lib/api/documentLinkSuggestions";
import { getJob } from "../../lib/api/jobs";
import { logger } from "../../lib/logger";
import { Button } from "../ui";
import { Card } from "../ui/Card";

const NS = "dataQuality:documentLinkSuggestions";
const POLL_MS = 1500;

/**
 * "Dieses Dokument belegt auch …" — stored documents whose parse reading names
 * other entries of their trip they are not linked to (plan D4). Nothing is
 * linked until the user ticks entries and confirms; "Nein" is remembered on
 * the server and never asked again.
 *
 * Reading the list makes the server scan the stored documents once (a job);
 * its progress is shown, and the list is read again when it finishes. A failed
 * load, accept or dismiss says so in place — never a silently empty block.
 * Disappears when there is nothing to decide.
 */
export default function DocumentLinkSuggestionsSection(): JSX.Element | null {
  const { t } = useTranslation(["dataQuality", "common"]);
  const [items, setItems] = useState<DocumentLinkSuggestion[]>([]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (keepError = false): Promise<void> => {
      try {
        const list = await documentLinkSuggestionsApi.list();
        setItems(list.suggestions);
        setJobId(list.pass.jobId);
        setTicked((prev) => {
          const next = { ...prev };
          for (const group of list.suggestions) {
            for (const e of group.entries)
              if (!(e.suggestionId in next)) next[e.suggestionId] = true;
          }
          return next;
        });
        if (!keepError) setError(null);
      } catch (err) {
        logger.warn("Failed to load document link suggestions:", err);
        setError(t(`${NS}.errors.load`));
      }
    },
    [t]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While the scan runs: show how far it is, and read the list again at the end.
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const tick = async (): Promise<void> => {
      try {
        const job = await getJob(jobId);
        if (stopped) return;
        setProgress(job.progress);
        if (job.status === "running") {
          timer = setTimeout(() => void tick(), POLL_MS);
          return;
        }
        setProgress(null);
        setJobId(null);
        if (job.status === "failed") setError(t(`${NS}.errors.scan`));
        else await load();
      } catch (err) {
        if (stopped) return;
        logger.warn("Failed to read the document link scan:", err);
        setProgress(null);
        setJobId(null);
        setError(t(`${NS}.errors.scan`));
      }
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(() => void tick(), 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, load, t]);

  const decide = async (
    group: DocumentLinkSuggestion,
    action: "accept" | "dismiss"
  ): Promise<void> => {
    const ids = group.entries.filter((e) => ticked[e.suggestionId]).map((e) => e.suggestionId);
    if (action === "accept" && ids.length === 0) return;
    setBusy(group.documentId);
    let failed = false;
    try {
      if (action === "accept") await documentLinkSuggestionsApi.accept(group.documentId, ids);
      else await documentLinkSuggestionsApi.dismiss(group.documentId);
      setError(null);
    } catch (err) {
      logger.warn("Failed to answer a document link suggestion:", err);
      failed = true;
      setError(t(`${NS}.errors.answer`));
    } finally {
      setBusy(null);
      // A reload must not wipe the sentence that says the answer was lost.
      await load(failed);
    }
  };

  if (items.length === 0 && !progress && !error) return null;

  return (
    <Card
      style={{ marginBottom: "var(--ts-space-xl)" }}
      aria-labelledby="doc-link-suggestions-title"
    >
      <h3
        id="doc-link-suggestions-title"
        style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t(`${NS}.title`)}
      </h3>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
        {t(`${NS}.description`)}
      </p>

      {progress && (
        <p className="t-caption" role="status" style={{ marginTop: "var(--ts-space-md)" }}>
          {t(`${NS}.scanning`, { done: progress.done, total: progress.total })}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="t-caption"
          style={{ marginTop: "var(--ts-space-md)", color: "var(--ts-warn)" }}
        >
          {error}
        </p>
      )}

      <ul
        className="flex flex-col"
        style={{ gap: "var(--ts-space-lg)", marginTop: "var(--ts-space-lg)" }}
      >
        {items.map((group) => {
          const anyTicked = group.entries.some((e) => ticked[e.suggestionId]);
          return (
            <li
              key={group.documentId}
              style={{ borderTop: "1px solid var(--ts-border)", paddingTop: "var(--ts-space-md)" }}
            >
              <fieldset className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
                <legend style={{ color: "var(--ts-text)", fontWeight: 600 }}>
                  {t(`${NS}.alsoCovers`, { name: group.displayName })}
                </legend>
                {group.entries.map((e) => (
                  <label key={e.suggestionId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!ticked[e.suggestionId]}
                      onChange={() =>
                        setTicked((prev) => ({ ...prev, [e.suggestionId]: !prev[e.suggestionId] }))
                      }
                    />
                    <span>
                      {e.label}
                      <span className="t-caption">
                        {" · "}
                        {t(`${NS}.reason.${e.reason}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--ts-space-md)" }}>
                <Button
                  variant="primary"
                  disabled={busy === group.documentId || !anyTicked}
                  onClick={() => void decide(group, "accept")}
                >
                  {t(`${NS}.accept`)}
                </Button>
                <Button
                  disabled={busy === group.documentId}
                  onClick={() => void decide(group, "dismiss")}
                >
                  {t(`${NS}.dismiss`)}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
