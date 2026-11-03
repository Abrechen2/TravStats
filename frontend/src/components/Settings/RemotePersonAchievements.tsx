import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingConnectionsApi } from "../../lib/api/sharingConnections";
import { logger } from "../../lib/logger";
import type { Connection, RemoteAchievements } from "../../types/sharingRemote";
import { remoteSharingError, type RemoteSharingError } from "../sharing/remoteSharingCopy";

const NS = "sharing:remote.connections.achievements";

/**
 * What a connected person shows of their achievements (read-only): the totals and the badges they
 * have earned, nothing behind them. A refusal is its own sentence - "not shared" is never drawn as
 * an empty list.
 */
export default function RemotePersonAchievements({
  person,
}: {
  person: Pick<Connection, "id">;
}): JSX.Element {
  const { t } = useTranslation(["sharing", "achievements"]);
  const [data, setData] = useState<RemoteAchievements | null>(null);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailure(null);
    sharingConnectionsApi
      .achievements(person.id)
      .then((next) => live && setData(next))
      .catch((error: unknown) => {
        logger.error("Reading a connected person's achievements failed:", error);
        if (live) setFailure(remoteSharingError(error, `${NS}.failed`));
      });
    return () => {
      live = false;
    };
  }, [person.id]);

  if (failure)
    return (
      <p role="alert" style={{ color: "var(--ts-warn)" }} data-testid="remote-achievements-error">
        {t(failure.key, { origin: failure.origin })}
      </p>
    );
  if (!data) return <p className="t-caption">{t(`${NS}.loading`)}</p>;
  const { summary, earned } = data;
  return (
    <div className="flex flex-col gap-2" data-testid="remote-achievements">
      <p className="t-caption">
        {t(`${NS}.summary`, {
          unlocked: summary.unlockedAchievements,
          total: summary.totalAchievements,
          points: summary.totalPoints,
        })}
      </p>
      {earned.length === 0 ? (
        <p className="t-caption">{t(`${NS}.none`)}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {earned.map((b) => (
            <li key={b.code} className="t-caption" data-testid="remote-badge">
              {t(`achievements:codes.${b.code}.name`, { defaultValue: b.name })} · {b.points}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
