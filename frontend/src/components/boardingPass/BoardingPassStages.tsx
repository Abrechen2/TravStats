import { useTranslation } from "../../hooks/useTranslation";
import type { BoardingPassStage } from "../../lib/api/types";
import { stageMessage } from "./stageCopy";

const TONE: Record<BoardingPassStage["status"], string> = {
  ok: "bg-green-900/20 border-green-800 text-green-200",
  partial: "bg-amber-900/20 border-amber-700 text-amber-200",
  failed: "bg-red-900/20 border-red-800 text-red-200",
  skipped: "bg-(--bg-elevated) border-border text-(--text-muted)",
};

const MARK: Record<BoardingPassStage["status"], string> = {
  ok: "✓",
  partial: "!",
  failed: "✕",
  skipped: "–",
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
          className={`flex items-start gap-3 p-3 rounded-lg border ${TONE[stage.status]}`}
          data-stage={stage.stage}
          data-status={stage.status}
        >
          <span aria-hidden="true" className="font-bold w-4 text-center">
            {MARK[stage.status]}
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
