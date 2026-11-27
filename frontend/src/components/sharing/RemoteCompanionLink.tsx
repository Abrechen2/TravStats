import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { RemoteMember } from "../../types/sharingRemote";
import { Button } from "../ui";

const NS = "sharing:remote.trip.companion";

/**
 * One person, one companion (2026-11-24), under a person on another server: the reader's
 * companion that IS them ("geteilt" with their handle, and a way to unlink), or — with none —
 * the question "Ist das <Name>?" for each companion whose name may be theirs. A name alone never
 * links: only the reader's "Ja" does, and "Nein" is remembered.
 */
export default function RemoteCompanionLink({
  tripId,
  member,
  busy,
  run,
}: {
  tripId: string;
  member: RemoteMember;
  busy: boolean;
  /** The parent's runner: reloads after the action, says a failure in its own words. */
  run: (action: () => Promise<void>, fallbackKey: string) => Promise<void>;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const bump = useTripSharingStore((s) => s.bump);
  // The trip head lists the person from the same answer: it reloads too.
  const act = (action: () => Promise<unknown>) =>
    void run(async () => {
      await action();
      bump(tripId);
    }, `${NS}.failed`);
  if (member.companion) {
    const companion = member.companion;
    return (
      <span className="flex flex-wrap items-center gap-2" data-testid="remote-companion-linked">
        <span className="t-caption">{t(`${NS}.linked`, { name: companion.name })}</span>
        <Button disabled={busy} onClick={() => act(() => sharingApi.unlinkCompanion(companion.id))}>
          {t(`${NS}.unlink`)}
        </Button>
      </span>
    );
  }
  const matches = member.nameMatches ?? [];
  if (matches.length === 0) return null;
  return (
    <span className="flex flex-col gap-1">
      {matches.map((match) => (
        <span
          key={match.id}
          className="flex flex-wrap items-center gap-2"
          data-testid="remote-companion-question"
        >
          <span>{t(`${NS}.question`, { name: match.name, person: member.displayName })}</span>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => act(() => sharingApi.linkRemoteCompanion(match.id, member.remoteId))}
          >
            {t(`${NS}.yes`)}
          </Button>
          <Button
            disabled={busy}
            onClick={() => act(() => sharingApi.markNotSameRemote(match.id, member.remoteId))}
          >
            {t(`${NS}.no`)}
          </Button>
        </span>
      ))}
    </span>
  );
}
