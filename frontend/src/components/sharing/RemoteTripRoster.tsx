import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { RosterPerson } from "../../types/sharingRemote";
import { Button, Pill } from "../ui";

const NS = "sharing:remote.trip.roster";

const COLOR: Readonly<Record<RosterPerson["relation"], string>> = {
  you: "var(--ts-muted)",
  here: "var(--ts-muted)",
  paired: "var(--ts-good)",
  accepted: "var(--ts-good)",
  pending: "var(--ts-warn)",
  declined: "var(--ts-muted)",
};

/**
 * Who is on the trip on other servers, and whether their changes reach the reader (spec
 * 2026-10-20 F-S4e, the roster): someone the reader is paired with, or said yes to, reaches their
 * copy; a newcomer does not until the reader says yes — each its own sentence, so a change that
 * did not arrive is never a mystery. A yes counts from now on: what came before is not replayed.
 */
export default function RemoteTripRoster({
  roster,
  busy,
  onDecide,
}: {
  roster: readonly RosterPerson[];
  busy: boolean;
  onDecide: (person: RosterPerson, decision: "accepted" | "declined") => void;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const others = roster.filter((p) => p.relation !== "you");
  if (others.length === 0) return null;
  const waiting = others.some((p) => p.relation === "pending");
  return (
    <div className="flex flex-col gap-2" data-testid="remote-roster">
      <h4 className="t-label-mono">{t(`${NS}.title`)}</h4>
      {waiting && <p className="t-caption">{t(`${NS}.hint`)}</p>}
      <ul className="flex flex-col gap-2">
        {others.map((p) => (
          <li key={p.ref} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span>{t(`${NS}.row`, { name: p.displayName, origin: p.origin })}</span>
              <Pill color={COLOR[p.relation]}>{t(`${NS}.relation.${p.relation}`)}</Pill>
            </span>
            <span className="t-caption" data-testid="remote-roster-status">
              {t(`${NS}.sentence.${p.relation}`, { name: p.displayName })}
            </span>
            {(p.relation === "pending" || p.relation === "declined") && (
              <span className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => onDecide(p, "accepted")}>
                  {t(`${NS}.accept`)}
                </Button>
                {p.relation === "pending" && (
                  <Button disabled={busy} onClick={() => onDecide(p, "declined")}>
                    {t(`${NS}.decline`)}
                  </Button>
                )}
              </span>
            )}
            {p.relation === "accepted" && (
              <span>
                <Button disabled={busy} onClick={() => onDecide(p, "declined")}>
                  {t(`${NS}.stop`)}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
