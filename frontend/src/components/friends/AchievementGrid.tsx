import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { Achievement } from "../../types";
import type { AchievementSection, LeaderboardRow } from "../../lib/comparison/types";
import { TIER_COLOR } from "../achievements/AchievementCard";
import { Toggletip } from "../ui";

type Item = AchievementSection["items"][number];

interface Props {
  self: LeaderboardRow;
  friend: { name: string; row?: LeaderboardRow };
  year: number | null;
  /** The reader's own catalogue: names, descriptions, icons, tiers and points. */
  catalogue: readonly Achievement[] | null;
  /** The friend's leaderboard grant carries their progress (§11.7); without it no progress is shown. */
  progressShared: boolean;
  /** The friend's earned-badges switch (§11.7), for the one line when there is no grid. */
  achievementsSwitch: boolean;
}

/** Why there is no grid, as a copy key. */
function unavailableKey(row: LeaderboardRow | undefined, switchOn: boolean): string {
  if (!row) return "status.withdrawn";
  if (row.status !== "ok") return `status.${row.status}`;
  if (row.achievementsUnavailable) return `achievements.unavailable.${row.achievementsUnavailable}`;
  return switchOn ? "friend.achievementsViaCompare" : "achievements.unavailable.notShared";
}

/**
 * Erfolge: ONE denominator — the badges both servers define — as a grid grouped "ihr beide",
 * "nur du", "nur <Name>" and "bei keinem von euch". Every badge opens an info popover on hover
 * and on tap (name, description, points, and progress only where the leaderboard grant carries
 * it). The popover is the shared Toggletip: keyboard-focusable, Escape and an outside tap close it.
 */
export default function AchievementGrid({
  self,
  friend,
  year,
  catalogue,
  progressShared,
  achievementsSwitch,
}: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "achievements"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const mine = self.achievements;
  const theirs = friend.row?.achievements;
  const byCode = new Map((catalogue ?? []).map((a) => [a.code, a] as const));

  if (year !== null || !mine)
    return (
      <p className="t-caption" data-testid="achievements-year-only">
        {tr("achievements.yearOnly")}
      </p>
    );
  if (!theirs)
    return (
      <p className="t-caption" data-testid="achievements-unavailable">
        {tr(unavailableKey(friend.row, achievementsSwitch), { name: friend.name })}
      </p>
    );

  const theirsBy = new Map(theirs.items.map((i) => [i.code, i] as const));
  const known = mine.items.filter((i) => theirsBy.has(i.code));
  const missing = mine.items.filter((i) => !theirsBy.has(i.code));
  const held = (i: Item): boolean => i.unlocked;
  const heldByThem = (i: Item): boolean => theirsBy.get(i.code)?.unlocked === true;
  const groups: { id: string; title: string; items: Item[] }[] = [
    { id: "both", title: tr("friend.both"), items: known.filter((i) => held(i) && heldByThem(i)) },
    {
      id: "you",
      title: tr("achievements.onlyYou"),
      items: known.filter((i) => held(i) && !heldByThem(i)),
    },
    {
      id: "them",
      title: tr("achievements.only", { name: friend.name }),
      items: known.filter((i) => !held(i) && heldByThem(i)),
    },
    {
      id: "none",
      title: tr("friend.neither"),
      items: known.filter((i) => !held(i) && !heldByThem(i)),
    },
  ];
  const nameOf = (code: string): string => {
    const a = byCode.get(code);
    return a ? String(t(`achievements:codes.${code}.name`, { defaultValue: a.name })) : code;
  };
  const percent = (p: number | null | undefined): string | null =>
    typeof p === "number" ? `${Math.round(p * 100)} %` : null;

  const info = (item: Item): JSX.Element => {
    const a = byCode.get(item.code);
    const myPct = progressShared ? percent(item.progress) : null;
    const theirPct = progressShared ? percent(theirsBy.get(item.code)?.progress) : null;
    return (
      <div data-testid={`ach-info-${item.code}`} className="flex flex-col" style={{ gap: 4 }}>
        <strong>{nameOf(item.code)}</strong>
        {a && (
          <span>
            {String(
              t(`achievements:codes.${item.code}.description`, { defaultValue: a.description })
            )}
          </span>
        )}
        {a && <span>{tr("achievements.points", { points: a.points })}</span>}
        {progressShared && !item.unlocked && myPct && (
          <span>{tr("friend.progressYou", { percent: myPct })}</span>
        )}
        {progressShared && !heldByThem(item) && theirPct && (
          <span>{tr("friend.progressThem", { name: friend.name, percent: theirPct })}</span>
        )}
      </div>
    );
  };

  const badge = (item: Item, dim: boolean): JSX.Element => {
    const a = byCode.get(item.code);
    return (
      <li key={item.code}>
        <Toggletip
          content={info(item)}
          label={nameOf(item.code)}
          position="top"
          data-testid={`badge-${item.code}`}
          triggerStyle={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "var(--ts-space-sm)",
            minHeight: "var(--ts-size-touch-min, 44px)",
            textAlign: "left",
            opacity: dim ? 0.5 : 1,
          }}
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              border: `2px solid ${a ? (TIER_COLOR[a.tier] ?? "var(--ts-muted)") : "var(--ts-muted)"}`,
            }}
          >
            {a?.icon ?? "·"}
          </span>
          <span className="min-w-0">{nameOf(item.code)}</span>
        </Toggletip>
      </li>
    );
  };

  const count = (items: readonly Item[]): string =>
    tr("achievements.count", { unlocked: items.filter(held).length, total: items.length });
  const mineKnown = known;
  const theirKnown = known.map((i) => theirsBy.get(i.code)).filter((i): i is Item => !!i);

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <p data-testid="ach-denominator" className="t-caption" style={{ margin: 0 }}>
        {tr("friend.denominator", { total: known.length })}
        {" · "}
        <span data-testid="ach-count-self">
          {tr("compare.you")}: {count(mineKnown)}
        </span>
        {" · "}
        <span data-testid="ach-count-friend">
          {friend.name}: {count(theirKnown)}
        </span>
      </p>
      {groups.map(({ id, title, items }) =>
        items.length === 0 ? null : (
          <div key={id} data-testid={`ach-${id}`}>
            <h4 className="t-section-label">{title}</h4>
            <ul
              className="m-0 grid list-none p-0"
              style={{
                gap: "var(--ts-space-xs) var(--ts-space-lg)",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              }}
            >
              {items.map((i) => badge(i, id === "none"))}
            </ul>
          </div>
        )
      )}
      {known.length === 0 && <p className="t-caption">{tr("achievements.none")}</p>}
      {missing.length > 0 && (
        <p className="t-caption" data-testid="ach-missing">
          {missing.map((i) => nameOf(i.code)).join(", ")} –{" "}
          {mine.catalogue === theirs.catalogue
            ? tr("achievements.notSharedCode", { name: friend.name })
            : tr("achievements.unknownOther")}
        </p>
      )}
    </div>
  );
}
