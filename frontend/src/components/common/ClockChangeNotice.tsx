import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { classifyWallClock } from "../../shared/time";
import type { Fold } from "../../lib/api/timeInput";

interface Props {
  /** The typed wall clock, `YYYY-MM-DDTHH:mm`; empty says nothing. */
  local: string;
  /** The place's zone, when the pick brought one; without it the server decides. */
  zone: string | null | undefined;
  fold: Fold | undefined;
  onFoldChange: (fold: "later" | undefined) => void;
}

/**
 * Says, next to a time field, when the typed time meets a clock change at the
 * place (ADR 0002, D3 / Q5):
 * - in a gap, that the time does not exist there — the server would refuse
 *   it; saying so before the save saves a round trip;
 * - in the repeated hour, that the EARLIER of the two is what gets saved, with
 *   a checkbox for the later one (`fold: "later"`).
 * Nothing is shown for an ordinary time or when the zone is not known here.
 */
export function ClockChangeNotice({ local, zone, fold, onFoldChange }: Props): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  if (!local || !zone) return null;
  const kind = classifyWallClock(local, zone);
  if (kind === "gap") {
    return (
      <p role="alert" className="mt-1 text-xs" style={{ color: "var(--danger)" }}>
        {t("common:clockChange.gap")}
      </p>
    );
  }
  if (kind !== "repeated") return null;
  return (
    <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
      <p style={{ margin: 0 }}>{t("common:clockChange.repeated")}</p>
      <label className="mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={fold === "later"}
          onChange={(e) => onFoldChange(e.target.checked ? "later" : undefined)}
        />
        {t("common:clockChange.later")}
      </label>
    </div>
  );
}
