import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { LinkButton } from "./notes";
import type { WriteReason, WriteState } from "./writeQueue";

interface SaveStateMarkProps {
  state: WriteState;
  reason?: WriteReason | null;
  onRetry?: () => void;
  onDiscard?: () => void;
}

/**
 * B6, single value: resting · saving in a moment · saved · failed.
 *
 * Resting draws nothing. Failed is not a toast: it stays on the row, in `warn`,
 * with the user's choice still in the control and two ways out — try again, or
 * discard (which brings the last SAVED value back).
 */
export function SaveStateMark({
  state,
  reason,
  onRetry,
  onDiscard,
}: SaveStateMarkProps): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  if (state === "idle") return null;

  if (state === "failed") {
    return (
      <div
        role="alert"
        data-save-state="failed"
        className="flex flex-wrap items-center"
        style={{ gap: "var(--ts-space-sm) var(--ts-space-md)", color: "var(--ts-warn)" }}
      >
        <span className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {t("settings:blocks.save.failed", {
            reason: t(`settings:blocks.save.reason.${reason ?? "rejected"}`),
          })}
        </span>
        {onRetry ? (
          <LinkButton onClick={onRetry}>{t("settings:blocks.save.retry")}</LinkButton>
        ) : null}
        {onDiscard ? (
          <LinkButton onClick={onDiscard}>{t("settings:blocks.save.discard")}</LinkButton>
        ) : null}
      </div>
    );
  }

  const key = state === "saved" ? "saved" : "waiting";
  return (
    <span
      role="status"
      data-save-state={state}
      className="t-caption"
      style={{ color: state === "saved" ? "var(--ts-good)" : "var(--ts-muted)" }}
    >
      {t(`settings:blocks.save.${key}`)}
    </span>
  );
}

interface GroupStateMarkProps {
  state: "unchanged" | "dirty" | "saving" | "saved" | "failed";
  reason?: WriteReason | null;
}

/** B6, group: "Nicht gespeichert" while the draft differs; the result after a save. */
export function GroupStateMark({ state, reason }: GroupStateMarkProps): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  if (state === "unchanged") return null;
  const text =
    state === "dirty"
      ? t("settings:blocks.save.unsaved")
      : state === "saving"
        ? t("settings:blocks.save.groupSaving")
        : state === "saved"
          ? t("settings:blocks.save.saved")
          : t("settings:blocks.save.failed", {
              reason: t(`settings:blocks.save.reason.${reason ?? "rejected"}`),
            });
  const color =
    state === "failed"
      ? "var(--ts-warn)"
      : state === "saved"
        ? "var(--ts-good)"
        : "var(--ts-muted)";
  return (
    <span
      role={state === "failed" ? "alert" : "status"}
      data-group-state={state}
      className="t-caption"
      style={{ color }}
    >
      {text}
    </span>
  );
}
