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
import { logger } from "../../lib/logger";
import { token } from "../ui/tokens";

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
  const [failed, setFailed] = useState<"load" | "save" | "lost" | "job" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoLinkRunResult | null>(null);

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
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t("visitPhotosAuto.truncatedVisits", { count: lastRun?.truncatedVisits ?? 0 })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t(
            {
              load: "visitPhotosAuto.loadFailed",
              save: "visitPhotosAuto.saveFailed",
              lost: "visitPhotosAuto.lost",
              job: "visitPhotosAuto.jobFailed",
            }[failed]
          )}
        </p>
      )}
    </div>
  );
}
