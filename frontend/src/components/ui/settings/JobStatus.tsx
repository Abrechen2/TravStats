import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { alpha } from "../tokens";
import { LinkButton } from "./notes";

export type JobView =
  | { kind: "waiting" }
  | { kind: "running"; what: string; done?: number; total?: number; eta?: string }
  | { kind: "done"; result: string }
  | { kind: "paused"; at: number; total: number; onResume: () => void }
  | { kind: "failed"; reason: string; onRetry: () => void }
  /** The server restarted meanwhile: whether it finished is not known. */
  | { kind: "unknown"; onCheck: () => void };

/**
 * B11: a background job on a row. Six states, each with its own sentence, and
 * the one the design insists on — "Ich weiß nicht, ob es fertig wurde" — is a
 * state of its own rather than a quiet "done".
 */
export function JobStatus({ job }: { job: JobView }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const percent =
    job.kind === "running" && job.total && job.done !== undefined
      ? Math.min(100, Math.round((job.done / job.total) * 100))
      : null;

  let body: JSX.Element;
  switch (job.kind) {
    case "waiting":
      body = <span>{t("settings:blocks.job.waiting")}</span>;
      break;
    case "running": {
      const parts = [
        job.what,
        job.total !== undefined && job.done !== undefined
          ? t("settings:blocks.job.progress", { done: job.done, total: job.total })
          : null,
        job.eta ? t("settings:blocks.job.eta", { eta: job.eta }) : null,
        t("settings:blocks.job.mayLeave"),
      ].filter(Boolean);
      body = <span>{parts.join(" · ")}</span>;
      break;
    }
    case "done":
      body = <span>{t("settings:blocks.job.done", { result: job.result })}</span>;
      break;
    case "paused":
      body = (
        <>
          <span>{t("settings:blocks.job.paused", { at: job.at, total: job.total })}</span>
          <LinkButton onClick={job.onResume}>{t("settings:blocks.job.resume")}</LinkButton>
        </>
      );
      break;
    case "failed":
      body = (
        <>
          <span style={{ color: "var(--ts-warn)" }}>
            {t("settings:blocks.job.failed", { reason: job.reason })}
          </span>
          <LinkButton onClick={job.onRetry}>{t("settings:blocks.job.retry")}</LinkButton>
        </>
      );
      break;
    case "unknown":
      body = (
        <>
          <span style={{ color: "var(--ts-warn)" }}>{t("settings:blocks.job.unknown")}</span>
          <LinkButton onClick={job.onCheck}>{t("settings:blocks.job.check")}</LinkButton>
        </>
      );
      break;
  }

  return (
    <div
      role="status"
      data-job={job.kind}
      className="flex flex-col"
      style={{ gap: "var(--ts-space-xs)" }}
    >
      <p
        className="t-caption flex flex-wrap items-center"
        style={{ gap: "var(--ts-space-sm)", margin: 0 }}
      >
        {body}
      </p>
      {percent !== null ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{
            height: 4,
            borderRadius: "var(--ts-radius-pill)",
            background: alpha("var(--ts-accent)", 12),
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${percent}%`, height: "100%", background: "var(--ts-accent)" }} />
        </div>
      ) : null}
    </div>
  );
}
