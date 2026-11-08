import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Button, EmptyState, Pill } from "../ui";
import IconButton from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { friendsApi } from "../../lib/api/friends";
import { logger } from "../../lib/logger";
import type { DomainKey } from "../../shared/domains";
import type { Achievement } from "../../types";
import type { LeaderboardRow } from "../../lib/comparison/types";
import type { Friend, FriendPlans, FriendTrips } from "../../lib/friends/types";
import AchievementGrid from "./AchievementGrid";
import CompareRows from "./CompareRows";
import FriendAvatar from "./FriendAvatar";
import FriendSettingsDialog from "./FriendSettingsDialog";
import InviteToPlan from "./InviteToPlan";
import { LOADING, type Loaded } from "./loadState";
import SharedPlans from "./SharedPlans";
import SharedTrips from "./SharedTrips";
import ShareTripWithFriend from "./ShareTripWithFriend";

interface Props {
  friend: Friend;
  self: LeaderboardRow | null;
  /** Undefined until the comparison answered; a friend the server no longer lists stays undefined after. */
  row?: LeaderboardRow;
  compareFailed: string | null;
  year: number | null;
  domains: ReadonlySet<DomainKey> | null;
  isEnabled: (domain: DomainKey) => boolean;
  catalogue: readonly Achievement[] | null;
  onChanged: () => void;
}

/** Loads one list, keeps its failure local, and reloads on demand. */
function useSection<T>(load: () => Promise<T>, what: string): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>(LOADING);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(LOADING);
    load().then(
      (value) => alive && setState({ status: "ok", value }),
      (failure: unknown) => {
        logger.error(`friends: ${what} load failed`, failure);
        if (alive) setState({ status: "error" });
      }
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is rebuilt per render; the key is the trigger
  }, [version, what]);
  return [state, useCallback(() => setVersion((v) => v + 1), [])];
}

/**
 * One friend, top to bottom (spec 2026-11-08 §11.5): head with the gear, Vergleich, Erfolge,
 * Geteilte Reisen, Gemeinsame Pläne. A section whose data owner switched it off says so in one
 * line instead of disappearing; only plans need both sides.
 */
export default function FriendPanel({
  friend,
  self,
  row,
  compareFailed,
  year,
  domains,
  isEnabled,
  catalogue,
  onChanged,
}: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [trips, reloadTrips] = useSection<FriendTrips>(
    () => friendsApi.trips(friend.key),
    `trips:${friend.key}`
  );
  const [plans, reloadPlans] = useSection<FriendPlans>(
    () => friendsApi.plans(friend.key),
    `plans:${friend.key}`
  );
  const [dialog, setDialog] = useState<"settings" | "share" | "invite" | null>(null);
  const name = friend.displayName;
  const compareOff = !friend.theirs.leaderboard;

  const vergleich = (): JSX.Element => {
    if (compareOff)
      return (
        <p className="t-caption" data-testid="compare-off">
          {friend.olderServer
            ? tr("friend.olderServer", { name })
            : tr("friend.compareOff", { name })}
        </p>
      );
    if (compareFailed)
      return (
        <EmptyState
          kind="degraded"
          title={tr("friends.loadFailed")}
          description={compareFailed}
          action={<Button onClick={onChanged}>{tr("friend.retry")}</Button>}
        />
      );
    if (!self) return <p className="t-caption">{tr("friend.loading")}</p>;
    return (
      <CompareRows
        self={self}
        friend={{ name, row }}
        year={year}
        domains={domains}
        isEnabled={isEnabled}
      />
    );
  };

  return (
    <article
      aria-label={name}
      data-testid={`friend-panel-${friend.key}`}
      className="flex flex-col"
      style={{ gap: "var(--ts-space-xxl)" }}
    >
      <header className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
        <FriendAvatar name={name} tone="them" size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="t-screen-title" style={{ margin: 0 }}>
            {name}
          </h2>
          <p className="t-caption" style={{ margin: 0 }}>
            {friend.origin ?? tr("people.thisServer")}
          </p>
        </div>
        {friend.olderServer && <Pill color="var(--ts-muted)">{tr("friend.olderServerPill")}</Pill>}
        <Pill color="var(--ts-muted)">{tr(`friend.state.${friend.state}`)}</Pill>
        <IconButton label={tr("friends.details", { name })} onClick={() => setDialog("settings")}>
          <Icon name="settings" size={18} />
        </IconButton>
      </header>

      <section
        aria-label={tr("friend.compareTitle")}
        className="flex flex-col"
        style={{ gap: "var(--ts-space-md)" }}
      >
        <h3 className="t-screen-title">{tr("friend.compareTitle")}</h3>
        {vergleich()}
      </section>

      <section
        aria-label={tr("achievements.title")}
        className="flex flex-col"
        style={{ gap: "var(--ts-space-md)" }}
      >
        <h3 className="t-screen-title">{tr("achievements.title")}</h3>
        {compareOff ? (
          <p className="t-caption" data-testid="achievements-off">
            {friend.theirs.achievements
              ? tr("friend.achievementsNoCompare", { name })
              : tr("achievements.unavailable.notShared", { name })}
          </p>
        ) : self ? (
          <AchievementGrid
            self={self}
            friend={{ name, row }}
            year={year}
            catalogue={catalogue}
            progressShared={friend.theirs.leaderboard}
            achievementsSwitch={friend.theirs.achievements}
          />
        ) : compareFailed ? (
          <p className="t-caption" data-testid="achievements-failed">
            {tr("friend.achievementsFailed")}
          </p>
        ) : (
          <p className="t-caption">{tr("friend.loading")}</p>
        )}
      </section>

      <SharedTrips
        friend={friend}
        trips={trips}
        onShare={() => setDialog("share")}
        onRetry={reloadTrips}
      />
      <SharedPlans
        friend={friend}
        plans={plans}
        onInvite={() => setDialog("invite")}
        onRetry={reloadPlans}
      />

      {dialog === "settings" && (
        <FriendSettingsDialog
          friend={friend}
          onClose={() => setDialog(null)}
          onChanged={onChanged}
        />
      )}
      {dialog === "share" && (
        <ShareTripWithFriend
          friend={friend}
          onClose={() => setDialog(null)}
          onShared={reloadTrips}
        />
      )}
      {dialog === "invite" && (
        <InviteToPlan friend={friend} onClose={() => setDialog(null)} onInvited={reloadPlans} />
      )}
    </article>
  );
}
