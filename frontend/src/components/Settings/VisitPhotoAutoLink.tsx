import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { failureKey } from "../../lib/api/immich";
import { JobFailedError, JobLostError } from "../../lib/api/jobs";
import {
  getAutoLinkStatus,
  setAutoLinkEnabled,
  type AutoLinkRunResult,
  type AutoLinkStatus,
} from "../../lib/api/places";
import { setPhotoCap, trimPhotoLinks, type TrimResult } from "../../lib/api/photoChoices";
import { logger } from "../../lib/logger";
import { token } from "../ui/tokens";
import InlineError from "../ui/InlineError";

const SOURCES = ["immich", "photoprism"] as const;

/**
 * "Fotos automatisch mit Ortsbesuchen verknüpfen": the account switch for the
 * server's automatic photo links, and — when the last pass could not read a
 * photo source — the reason, so a failing source never reads as "no photos".
 */
export default function VisitPhotoAutoLink(): JSX.Element | null {
  const { t } = useTranslation("immich");
  const { isEnabled } = useEnabledDomains();
  const [status, setStatus] = useState<AutoLinkStatus | null>(null);
  const [failed, setFailed] = useState<"load" | "save" | "lost" | "job" | "cap" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoLinkRunResult | null>(null);
  const [trim, setTrim] = useState<TrimResult | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await getAutoLinkStatus());
      setFailed(null);
    } catch (err: unknown) {
      logger.error("VisitPhotoAutoLink: load failed", err);
      setFailed("load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!isEnabled("poi")) return null;

  const toggle = async (enabled: boolean): Promise<void> => {
    setFailed(null);
    setResult(null);
    setRunning(enabled);
    try {
      setResult(await setAutoLinkEnabled(enabled, setProgress));
    } catch (err: unknown) {
      logger.error("VisitPhotoAutoLink: switch failed", err);
      // A lost job is "unknown", never "failed": links already made stay.
      setFailed(
        err instanceof JobLostError ? "lost" : err instanceof JobFailedError ? "job" : "save"
      );
    } finally {
      setRunning(false);
      setProgress(null);
      await load();
    }
  };

  const changeCap = async (cap: number): Promise<void> => {
    setFailed(null);
    setTrim(null);
    setRunning(true);
    try {
      setTrim(await setPhotoCap(cap, setProgress));
    } catch (err: unknown) {
      logger.error("VisitPhotoAutoLink: cap failed", err);
      setFailed(err instanceof JobLostError ? "lost" : "cap");
    } finally {
      setRunning(false);
      setProgress(null);
      await load();
    }
  };

  const runTrim = async (): Promise<void> => {
    setFailed(null);
    setTrim(null);
    setRunning(true);
    try {
      setTrim(await trimPhotoLinks(setProgress));
    } catch (err: unknown) {
      logger.error("VisitPhotoAutoLink: trim failed", err);
      setFailed(err instanceof JobLostError ? "lost" : "job");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const capMin = status?.capMin ?? 5;
  const capMax = status?.capMax ?? 10;
  const capOptions = Array.from({ length: capMax - capMin + 1 }, (_, i) => capMin + i);

  const problems = SOURCES.flatMap((source) => {
    const state = status?.lastRun?.sources[source];
    return state && state !== "ok" && state !== "notConfigured"
      ? [
          `${t(`visitPhotosAuto.source.${source}`)}: ${
            state === "truncated" ? t("visitPhotosAuto.truncated") : t(failureKey(state, source))
          }`,
        ]
      : [];
  });
  const lastRun = result ?? status?.lastRun ?? null;
  const failures = lastRun && "failures" in lastRun ? (lastRun.failures ?? []) : [];

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={status?.enabled ?? true}
          disabled={status === null || running}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="label">{t("visitPhotosAuto.title")}</span>
      </label>
      <p className="t-caption">{t("visitPhotosAuto.hint")}</p>
      <label className="flex items-center gap-2">
        <span className="label">{t("visitPhotosAuto.cap")}</span>
        <select
          value={status?.cap ?? 6}
          disabled={status === null || running}
          onChange={(e) => void changeCap(Number(e.target.value))}
          style={{ minHeight: 44 }}
        >
          {capOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="t-caption">{t("visitPhotosAuto.capHint")}</p>
      <button
        type="button"
        onClick={() => void runTrim()}
        disabled={status === null || running}
        className="self-start text-xs underline-offset-2 hover:underline disabled:opacity-50"
        style={{ minHeight: 44, background: "none", border: "none", padding: 0 }}
      >
        {t("visitPhotosAuto.trim")}
      </button>
      {trim && (
        <p role="status" className="text-sm">
          {t("visitPhotosAuto.trimDone", { count: trim.removed })}
        </p>
      )}
      {problems.map((line) => (
        <p key={line} role="alert" className="text-sm" style={{ color: token("bad") }}>
          {line}
        </p>
      ))}
      {running && (
        <p role="status" className="t-caption">
          {progress && progress.total > 0
            ? t("visitPhotosAuto.progress", { done: progress.done, total: progress.total })
            : t("visitPhotosAuto.running")}
        </p>
      )}
      {result && (
        <p role="status" className="text-sm">
          {t("visitPhotosAuto.done", { visits: result.visits, linked: result.linked })}
        </p>
      )}
      {(lastRun?.failedVisits ?? 0) > 0 && (
        <div role="alert" className="text-sm" style={{ color: token("bad") }}>
          <p>{t("visitPhotosAuto.failedVisits", { count: lastRun?.failedVisits ?? 0 })}</p>
          {failures.map((f) => (
            <p key={f.visitId} className="t-caption">
              {t(failureKey(f.reason))}
            </p>
          ))}
        </div>
      )}
      {(lastRun?.truncatedVisits ?? 0) > 0 && (
        <InlineError>
          {t("visitPhotosAuto.truncatedVisits", { count: lastRun?.truncatedVisits ?? 0 })}
        </InlineError>
      )}
      {failed && (
        <InlineError>
          {t(
            {
              load: "visitPhotosAuto.loadFailed",
              save: "visitPhotosAuto.saveFailed",
              lost: "visitPhotosAuto.lost",
              job: "visitPhotosAuto.jobFailed",
              cap: "visitPhotosAuto.capSaveFailed",
            }[failed]
          )}
        </InlineError>
      )}
    </div>
  );
}
