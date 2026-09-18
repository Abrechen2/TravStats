import type { JSX } from "react";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { formatDate } from "../../lib/displayFormat";
import type { Achievement } from "../../types";

/**
 * What one achievement says about itself.
 *
 * #330: every card drew a pointer cursor and unlocked ones grew on hover,
 * while nothing was clickable — a tester clicked and nothing happened. The
 * owner's call (2026-09-11) was to keep the affordance and make it true, and
 * the scope (2026-09-17) is what this shows: the badge, the progress, and the
 * date it was unlocked. Deliberately NOT which flights or stays earned it —
 * the engine stores `progress` and `requirement`, not the rows behind them, so
 * naming them here would be a claim this dialog cannot back.
 *
 * That is a statement about the data, not a verdict on the feature, and it has
 * a date on it: the evidence endpoint is being built on `dev/design-system`
 * (confirmed by that session on 2026-09-18). When it lands, showing what
 * earned an achievement is a WIRING job in here, not a new surface — pass the
 * rows in and render them below the progress. Whoever does it should not read
 * the paragraph above as a decision against it.
 *
 * A hidden achievement that is still locked stays hidden in here too. The
 * grid draws it as "???" on purpose; a dialog that spelled it out would be a
 * way to read every secret by clicking.
 *
 * Kept as its own component rather than folded into the page: the page is
 * being rebuilt on `dev/design-system`, and a dialog that takes one
 * `Achievement` survives that. Wiring it is one prop wherever the card ends
 * up living.
 */
export default function AchievementDetailModal({
  achievement,
  onClose,
}: {
  /** The achievement to describe, or null while nothing is selected. */
  achievement: Achievement | null;
  onClose: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["achievements", "common"]);
  if (!achievement) return null;

  const isMystery = Boolean(achievement.isHidden) && !achievement.isUnlocked;
  const name = isMystery
    ? "???"
    : t(`achievements:codes.${achievement.code}.name`, { defaultValue: achievement.name });
  const description = isMystery
    ? t("achievements:hiddenDescription", {
        defaultValue: "Hidden achievement — complete it to reveal the details.",
      })
    : t(`achievements:codes.${achievement.code}.description`, {
        defaultValue: achievement.description,
      });

  const progress = achievement.progress ?? 0;
  const requirement = achievement.requirement;
  // The engine's own numbers. A percentage is not recomputed here — a second
  // place that divides is a second place that can disagree.
  const percentage =
    achievement.progressPercentage ??
    (requirement > 0 ? Math.min(100, Math.round((progress / requirement) * 100)) : 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">
            {isMystery ? "❔" : achievement.icon}
          </span>
          <span>{name}</span>
        </span>
      }
      maxWidth={520}
      testId="achievement-detail-modal"
      closeLabel={t("common:accessibility.close")}
    >
      <div className="space-y-4">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>

        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider">
          <span
            className="rounded-sm px-2 py-1 font-bold"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
            data-testid="achievement-detail-tier"
          >
            {t(`achievements:tiers.${achievement.tier}`)}
          </span>
          <span
            className="rounded-sm px-2 py-1"
            style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
          >
            {t(`achievements:categories.${achievement.category}`, {
              defaultValue: achievement.category,
            })}
          </span>
        </div>

        {achievement.isUnlocked ? (
          <div className="space-y-1" data-testid="achievement-detail-unlocked">
            <div className="text-sm" style={{ color: "var(--text-primary)" }}>
              {achievement.unlockedAt
                ? t("achievements:progress.unlocked", {
                    date: formatDate(achievement.unlockedAt),
                  })
                : t("achievements:summary.unlocked")}
            </div>
            <div className="text-sm font-bold" style={{ color: "var(--accent)" }}>
              +{achievement.points}
            </div>
          </div>
        ) : (
          <div className="space-y-2" data-testid="achievement-detail-progress">
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--text-muted)" }}>{t("achievements:progress.label")}</span>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {progress} / {requirement}
              </span>
            </div>
            <div className="h-2 w-full rounded-full" style={{ background: "var(--bg-muted)" }}>
              <div
                className="h-2 rounded-full"
                style={{ width: `${percentage}%`, background: "var(--accent)" }}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
