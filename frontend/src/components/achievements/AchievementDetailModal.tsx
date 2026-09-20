import type { JSX } from "react";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { formatDate } from "../../lib/displayFormat";
import { localeForLanguage } from "../../lib/units";
import EvidenceTrigger from "../Stats/EvidenceTrigger";
import { evidenceKeyForRule } from "./achievementEvidenceKey";
import { progressUnitForRule } from "./achievementProgressUnit";
import type { Achievement } from "../../types";

/**
 * What one achievement says about itself.
 *
 * #330: every card drew a pointer cursor and unlocked ones grew on hover,
 * while nothing was clickable — a tester clicked and nothing happened. The
 * owner's call (2026-09-11) was to keep the affordance and make it true, and
 * the scope (2026-09-17) is what this shows: the badge, the progress, and the
 * date it was unlocked.
 *
 * Since the beta audit of 2026-09-19 it also shows the ENTRIES behind the
 * statistic, which the public #330 comment promised and this dialog did not
 * have. `kind=achievement` still answers 501 (release 2), but most rules do
 * not need it: "Absolviere 10 Flüge" counts the flights `flightCount` already
 * lists. `achievementEvidenceKey.ts` is that join, and it is deliberately
 * partial — a rule with no served measure says so in one sentence rather than
 * drawing a trigger over a 404.
 *
 * The progress fraction is formatted in the reader's locale, with the rule's
 * unit where it has one: `495456 / 500000` read as neither a distance nor a
 * number (audit finding, unlisted 4).
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
  const { t, i18n } = useTranslation(["achievements", "common"]);
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

  // `localeForLanguage` rather than `toLocaleString()` with no argument: the
  // browser/OS locale is not the language the page is in, and units.ts owns
  // that rule for every other number on the site.
  const locale = localeForLanguage(i18n.language);
  const unitKey = progressUnitForRule(achievement.requirementType);
  const unit = unitKey ? ` ${t(`achievements:progress.units.${unitKey}`)}` : "";
  const progressText = `${progress.toLocaleString(locale)} / ${requirement.toLocaleString(locale)}${unit}`;

  // A hidden achievement keeps its secret here too — naming the statistic
  // behind it, or listing the entries, would spell out what the grid draws as
  // "???" on purpose.
  const evidenceKey = isMystery ? null : evidenceKeyForRule(achievement.requirementType);

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
                {progressText}
              </span>
            </div>
            <div className="h-2 w-full rounded-full" style={{ background: "var(--bg-muted)" }}>
              <div
                className="h-2 rounded-full"
                style={{ width: `${percentage}%`, background: "var(--accent)" }}
              />
            </div>
            {!isMystery && achievement.unlockedAt && (
              // The badge is not held — but it was. Held-ness follows the live
              // measure (owner's ruling, 2026-09-20), while `unlockedAt` is a
              // historical fact that is never cleared, so this is the one
              // sentence that explains why the points went away. Withheld on a
              // mystery card, which is still meant to give nothing away.
              <p
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
                data-testid="achievement-detail-last-held"
              >
                {t("achievements:progress.lastHeld", {
                  date: formatDate(achievement.unlockedAt),
                })}
              </p>
            )}
          </div>
        )}

        {!isMystery &&
          (evidenceKey ? (
            <EvidenceTrigger
              kind="metric"
              evidenceKey={evidenceKey}
              renderedValue={achievement.progress ?? null}
              label={t("achievements:progress.evidence.trigger")}
              className="text-sm underline"
              style={{ color: "var(--accent)" }}
            >
              {t("achievements:progress.evidence.trigger")}
            </EvidenceTrigger>
          ) : (
            <p
              className="text-xs"
              style={{ color: "var(--text-muted)" }}
              data-testid="achievement-detail-no-evidence"
            >
              {t("achievements:progress.evidence.none")}
            </p>
          ))}
      </div>
    </Modal>
  );
}
