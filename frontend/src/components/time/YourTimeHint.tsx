import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { yourTimeText } from "../../lib/yourTime";
import type { TimeValue } from "../../shared/time";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * "deine Zeit: 17:40" — the same instant on the user's own clock, small and
 * secondary beside a place's time (owner decision Q2). It never replaces the
 * place's time and renders nothing when there is nothing to add: a value
 * without a time of day, or a user already on the place's clock.
 */
export default function YourTimeHint({
  value,
}: {
  value: TimeValue | null | undefined;
}): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  const zone = useSettingsStore((s) => s.display?.timezone);
  const text = yourTimeText(value, zone, t);
  if (!text) return null;
  return (
    <span
      data-testid="your-time-hint"
      className="text-[10px]"
      style={{ color: "var(--text-muted)", opacity: 0.85 }}
      title={t("common:time.yourTimeTitle", { zone })}
    >
      {text}
    </span>
  );
}
