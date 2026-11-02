import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { ConnectionSwitches, RemoteStatsLevel } from "../../types/sharingRemote";
import { Switch } from "../ui/Field";
import { Segmented } from "../ui/Segmented";

const NS = "sharing:remote.connections.switches";
const LEVELS: readonly RemoteStatsLevel[] = ["off", "overview", "full"];

interface Props {
  idPrefix: string;
  value: ConnectionSwitches;
  onChange: (next: ConnectionSwitches) => void;
  disabled?: boolean;
}

/**
 * What the caller gives one person (spec 2026-11-02 §2): share plans, statistics (off, Übersicht,
 * Voll), achievements, the leaderboard, and accepting trip offers. Directional and all off until
 * switched on; used when asking, when confirming and when changing.
 */
export default function ConnectionSwitchesForm({
  idPrefix,
  value,
  onChange,
  disabled = false,
}: Props): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const flag = (key: "plans" | "achievements" | "leaderboard" | "tripOffers") => (
    <Switch
      id={`${idPrefix}-${key}`}
      label={t(`${NS}.${key}.label`)}
      sub={t(`${NS}.${key}.sub`)}
      checked={value[key]}
      disabled={disabled}
      onChange={(next) => onChange({ ...value, [key]: next })}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      {flag("plans")}
      <div className="flex flex-col gap-1">
        <span>{t(`${NS}.stats.label`)}</span>
        <Segmented
          label={t(`${NS}.stats.label`)}
          value={value.stats}
          disabled={disabled}
          options={LEVELS.map((level) => ({ value: level, label: t(`${NS}.stats.${level}`) }))}
          onChange={(stats) => onChange({ ...value, stats })}
        />
        {value.stats === "overview" && <p className="t-caption">{t(`${NS}.stats.hintOverview`)}</p>}
        {value.stats === "full" && <p className="t-caption">{t(`${NS}.stats.hintFull`)}</p>}
      </div>
      {flag("achievements")}
      {flag("leaderboard")}
      {flag("tripOffers")}
    </div>
  );
}

/** "Teilt mit dir: …" — the switches the other side gave, as a short list; null when none. */
export function theirsSummary(
  theirs: ConnectionSwitches,
  t: (key: string) => string
): string | null {
  const parts: string[] = [];
  if (theirs.plans) parts.push(t(`${NS}.plans.short`));
  if (theirs.stats !== "off")
    parts.push(`${t(`${NS}.stats.short`)} (${t(`${NS}.stats.${theirs.stats}`)})`);
  if (theirs.achievements) parts.push(t(`${NS}.achievements.short`));
  if (theirs.leaderboard) parts.push(t(`${NS}.leaderboard.short`));
  if (theirs.tripOffers) parts.push(t(`${NS}.tripOffers.short`));
  return parts.length > 0 ? parts.join(", ") : null;
}
