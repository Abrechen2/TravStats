import { Icon, type IconName } from "../ui/Icon";
import type { CSSProperties } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { BoardingPassStage } from "../../lib/api/types";
import { stageMessage } from "./stageCopy";

/** Each status in the token layer's colours: a tinted surface, its border and text. */
const tone = (token: string) => ({
  background: `color-mix(in srgb, var(${token}) 12%, transparent)`,
  borderColor: `color-mix(in srgb, var(${token}) 45%, transparent)`,
  color: `var(${token})`,
});
const TONE: Record<BoardingPassStage["status"], CSSProperties> = {
  ok: tone("--success"),
  partial: tone("--warning"),
  failed: tone("--danger"),
  skipped: {
    background: "var(--bg-elevated)",
    borderColor: "var(--border)",
    color: "var(--text-muted)",
  },
};

const MARK: Record<BoardingPassStage["status"], IconName> = {
  ok: "check",
  partial: "circle-alert",
  failed: "x",
  skipped: "minus",
};

/**
 * What each step of reading the boarding pass did, in order — like the import
 * diagnostics. Shown for a success as well as a failure: "the barcode was
 * read, the flight lookup found nothing" is what tells the user to type the
 * time themselves, instead of a form that is silently half-empty.
 */
export default function BoardingPassStages({
  stages,
}: {
  stages: readonly BoardingPassStage[];
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  return (
    <ol className="space-y-2" aria-label={t("flights:scanner.steps.server")}>
      {stages.map((stage) => (
        <li
          key={stage.stage}
          className="flex items-start gap-3 p-3 rounded-lg border"
          style={TONE[stage.status]}
          data-stage={stage.stage}
          data-status={stage.status}
        >
          <span aria-hidden="true" className="font-bold w-4 text-center">
            <Icon name={MARK[stage.status]} size={14} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{t(`flights:scanner.stage.${stage.stage}`)}</p>
            <p className="text-sm opacity-90">{stageMessage(stage, t)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
