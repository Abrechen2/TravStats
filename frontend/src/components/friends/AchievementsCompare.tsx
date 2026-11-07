import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { Achievement } from "../../types";
import type { AchievementSection, LeaderboardRow } from "../../lib/comparison/types";
import { TIER_COLOR } from "../achievements/AchievementCard";
import type { ComparedFriend } from "./CompareTable";

type Item = AchievementSection["items"][number];

interface Props {
  self: LeaderboardRow;
  friends: readonly ComparedFriend[];
  year: number | null;
  /** The reader's own catalogue, for names, icons, tiers and points; null while it loads or failed. */
  catalogue: readonly Achievement[] | null;
}

/** What a friend's achievements say, or why they say nothing. */
function unavailableKey(row: LeaderboardRow | undefined): string | null {
  if (!row) return "status.withdrawn";
  if (row.status !== "ok") return `status.${row.status}`;
  if (row.achievementsUnavailable) return `achievements.unavailable.${row.achievementsUnavailable}`;
  return row.achievements ? null : "achievements.unavailable.notShared";
}

/**
 * Counts and points side by side, then the badges both of you could hold, grouped as "ihr beide",
 * "nur du" and "nur <Freund>" with a progress bar for whoever has not got one yet. Only codes
 * both sides define are compared; a code the other server does not know is named as such.
 */
export default function AchievementsCompare({
  self,
  friends,
  year,
  catalogue,
}: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "achievements"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const byCode = new Map((catalogue ?? []).map((a) => [a.code, a] as const));
  const mine = self.achievements;

  const nameOf = (code: string): string => {
    const a = byCode.get(code);
    return a ? String(t(`achievements:codes.${code}.name`, { defaultValue: a.name })) : code;
  };
  const badge = (code: string, lacking?: Item): JSX.Element => {
    const a = byCode.get(code);
    return (
      <li key={code} className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{
            border: `2px solid ${a ? (TIER_COLOR[a.tier] ?? "var(--ts-muted)") : "var(--ts-muted)"}`,
          }}
        >
          {a?.icon ?? "·"}
        </span>
        <span className="min-w-0">{nameOf(code)}</span>
        {bar(lacking)}
      </li>
    );
  };
  const pct = (item: Item | undefined): string =>
    tr("achievements.open", { percent: Math.round((item?.progress ?? 0) * 100) });
  const bar = (item: Item | undefined): JSX.Element | null =>
    item && item.progress !== null ? (
      <span
        role="progressbar"
        aria-label={pct(item)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(item.progress * 100)}
        title={pct(item)}
        className="inline-block shrink-0 overflow-hidden rounded-full"
        style={{ width: 80, height: 6, background: "var(--ts-border)" }}
      >
        <span
          className="block h-full"
          style={{ width: `${Math.round(item.progress * 100)}%`, background: "var(--ts-accent)" }}
        />
      </span>
    ) : null;
  const pointsOf = (items: readonly Item[]): number =>
    items.reduce((sum, i) => sum + (i.unlocked ? (byCode.get(i.code)?.points ?? 0) : 0), 0);
  const count = (items: readonly Item[]): string =>
    tr("achievements.count", {
      unlocked: items.filter((i) => i.unlocked).length,
      total: items.length,
    });

  if (year !== null || !mine) {
    return (
      <p className="t-caption" data-testid="achievements-year-only">
        {tr("achievements.yearOnly")}
      </p>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-xl)" }}>
        <div data-testid="ach-count-self">
          <strong>{tr("compare.you")}</strong>
          <div>{count(mine.items)}</div>
          <div className="t-caption">
            {tr("achievements.points", { points: pointsOf(mine.items) })}
          </div>
        </div>
        {friends.map((f) => (
          <div key={f.key} data-testid={`ach-count-${f.key}`}>
            <strong>{f.name}</strong>
            {f.row?.achievements ? (
              <>
                <div>{count(f.row.achievements.items)}</div>
                <div className="t-caption">
                  {tr("achievements.points", { points: pointsOf(f.row.achievements.items) })}
                </div>
              </>
            ) : (
              <div className="t-caption">
                {tr(unavailableKey(f.row) ?? "status.unknown", { name: f.name })}
              </div>
            )}
          </div>
        ))}
      </div>
      {friends.map((f) => {
        const theirs = f.row?.achievements;
        if (!theirs) return null;
        const theirsBy = new Map(theirs.items.map((i) => [i.code, i] as const));
        const known = mine.items.filter((i) => theirsBy.has(i.code));
        const missing = mine.items.filter((i) => !theirsBy.has(i.code));
        const both = known.filter((i) => i.unlocked && theirsBy.get(i.code)?.unlocked);
        const onlyMe = known.filter((i) => i.unlocked && !theirsBy.get(i.code)?.unlocked);
        const onlyThem = known.filter((i) => !i.unlocked && theirsBy.get(i.code)?.unlocked);
        const sameCatalogue = mine.catalogue === theirs.catalogue;
        /** `lacking` picks, per badge, the progress of whoever does not hold it yet. */
        const group = (
          id: string,
          title: string,
          items: Item[],
          lacking: (i: Item) => Item | undefined
        ): JSX.Element | null =>
          items.length === 0 ? null : (
            <div key={id} data-testid={`ach-${id}-${f.key}`}>
              <h4 className="t-section-label">{title}</h4>
              <ul
                className="m-0 grid list-none p-0"
                style={{
                  gap: "var(--ts-space-sm) var(--ts-space-lg)",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                }}
              >
                {items.map((i) => badge(i.code, lacking(i)))}
              </ul>
            </div>
          );
        return (
          <section key={f.key} className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
            <h3 className="t-section-label">{tr("achievements.withName", { name: f.name })}</h3>
            {group("both", tr("achievements.both"), both, () => undefined)}
            {group("you", tr("achievements.onlyYou"), onlyMe, (i) => theirsBy.get(i.code))}
            {group("them", tr("achievements.only", { name: f.name }), onlyThem, (i) => i)}
            {known.length === 0 && <p className="t-caption">{tr("achievements.none")}</p>}
            {missing.length > 0 && (
              <p className="t-caption" data-testid={`ach-missing-${f.key}`}>
                {missing.map((i) => nameOf(i.code)).join(", ")} –{" "}
                {sameCatalogue
                  ? tr("achievements.notSharedCode", { name: f.name })
                  : tr("achievements.unknownOther")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
