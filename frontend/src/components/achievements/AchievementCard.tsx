import type { JSX } from "react";
import type { Achievement } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { formatIsoDate } from "../../lib/dateUtils";

/**
 * Tier colours, from the token layer.
 *
 * Three of the five were literals once — bronze, platinum and diamond — while
 * silver and gold pointed at app variables. Nothing tied them together, so a
 * change upstream would have moved three of the five and left two behind.
 */
export const TIER_COLOR: Record<string, string> = {
  bronze: "var(--ts-tier-bronze)",
  silver: "var(--ts-tier-silver)",
  gold: "var(--ts-tier-gold)",
  platinum: "var(--ts-tier-platinum)",
  diamond: "var(--ts-tier-diamond)",
};

/**
 * One achievement, round 4 ("Erfolge"): the mark in a ring of its tier colour
 * (dashed while open), name and description beside it, and one mono foot line
 * — tier and points, then the ISO unlock date or the progress with a bar.
 *
 * The card used to be three times the height, fade locked ones to 60 % and
 * grey them, and hang a large padlock over the text. Open reads as open here
 * through the dashed ring and the progress bar, and every card stays legible.
 */
export default function AchievementCard({
  achievement,
  onOpen,
}: {
  achievement: Achievement;
  /**
   * Opens this achievement's detail dialog. Optional so the card still renders
   * where nothing listens — but where it IS passed the card becomes a real
   * button rather than a div with a click handler. GitHub #330 exists because
   * a card drew a pointer cursor while nothing was clickable and a tester
   * clicked into nothing; a control that a keyboard cannot reach is the same
   * failure for half the readers.
   */
  onOpen?: () => void;
}): JSX.Element {
  const { t } = useTranslation(["achievements"]);
  const isMystery = Boolean(achievement.isHidden) && !achievement.isUnlocked;
  const tier = TIER_COLOR[achievement.tier] ?? "var(--ts-muted)";
  const color = achievement.isUnlocked ? tier : "var(--ts-muted)";

  const surface = {
    padding: "var(--ts-space-lg)",
    background: "var(--ts-surface)",
    border: "1px solid var(--ts-border)",
    borderRadius: "var(--ts-radius-card)",
  } as const;

  const body = (
    <>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg leading-none"
          style={{
            border: `2px ${achievement.isUnlocked ? "solid" : "dashed"} ${tier}`,
            opacity: achievement.isUnlocked ? 1 : 0.7,
          }}
        >
          {isMystery ? "?" : achievement.icon}
        </span>
        <div className="min-w-0">
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ts-text-bright)" }}>
            {isMystery
              ? "???"
              : t(`achievements:codes.${achievement.code}.name`, {
                  defaultValue: achievement.name,
                })}
          </h3>
          <p className="t-caption">
            {isMystery
              ? t("achievements:hiddenDescription", {
                  defaultValue: "Hidden achievement — complete it to reveal the details.",
                })
              : t(`achievements:codes.${achievement.code}.description`, {
                  defaultValue: achievement.description,
                })}
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div
          className="flex items-baseline justify-between gap-2 text-xs"
          style={{ fontFamily: "var(--ts-font-mono)" }}
        >
          <span>
            <span style={{ color, fontWeight: 700, textTransform: "uppercase" }}>
              {isMystery
                ? t("achievements:hiddenBadge", { defaultValue: "Hidden" })
                : t(`achievements:tiers.${achievement.tier}`)}
            </span>
            <span className="t-caption"> · {achievement.points} P</span>
          </span>
          <span style={{ color: "var(--ts-text)" }}>
            {achievement.isUnlocked
              ? achievement.unlockedAt
                ? formatIsoDate(achievement.unlockedAt)
                : null
              : isMystery
                ? null
                : `${achievement.progress} / ${achievement.requirement}`}
          </span>
        </div>
        {!achievement.isUnlocked && !isMystery && achievement.unlockedAt && (
          // A badge the user HAD. Held-ness is the live measure since the
          // owner's ruling of 2026-09-20, so deleting the flights behind a
          // badge takes it and its points away — and without this line that is
          // a total silently going down with nothing to read it against.
          // `unlockedAt` survives the fall (it is never cleared), so the card
          // can say when. Not drawn on a mystery card: "last held" under a
          // "???" would give away that the user once solved it.
          <p className="t-caption" data-testid="achievement-last-held">
            {t("achievements:progress.lastHeld", {
              date: formatIsoDate(achievement.unlockedAt),
            })}
          </p>
        )}
        {!achievement.isUnlocked && !isMystery && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(achievement.progressPercentage ?? 0)}
            aria-label={t("achievements:progress.label")}
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: "var(--ts-surface2)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${achievement.progressPercentage ?? 0}%`, background: tier }}
            />
          </div>
        )}
      </div>
    </>
  );

  if (!onOpen) {
    return (
      <article className="flex h-full flex-col gap-3" style={surface}>
        {body}
      </article>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex h-full cursor-pointer flex-col gap-3 text-left"
      style={{ ...surface, width: "100%", font: "inherit", color: "inherit" }}
    >
      {body}
    </button>
  );
}
