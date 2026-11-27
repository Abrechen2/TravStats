import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { Switch } from "../../ui/Field";
import OverflowMenu from "../../ui/OverflowMenu";
import type { OverflowEntry } from "../../ui/OverflowMenu";
import type { PersonEntry } from "./buildPeople";

/** What the row's controls ask the section to do; the section owns every call and its failure. */
export interface PersonHandlers {
  toggleShare: (p: PersonEntry, on: boolean) => void;
  toggleTotals: (p: PersonEntry, on: boolean) => void;
  editTotalsScope: (p: PersonEntry) => void;
  link: (p: PersonEntry) => void;
  rename: (p: PersonEntry) => void;
  merge: (p: PersonEntry) => void;
  remove: (p: PersonEntry) => void;
  endConnection: (p: PersonEntry) => void;
  withdrawPaired: (p: PersonEntry) => void;
  withdrawIncoming: (p: PersonEntry) => void;
  toggleStats: (p: PersonEntry) => void;
  toggleAchievements: (p: PersonEntry) => void;
  /** "Alle passenden Reisen verknüpfen" / "Gemeinsame Reisen anbieten" (UAT 2026-11-27). */
  bulkLink: (p: PersonEntry) => void;
}

const NS = "sharing:friends";

/** The switches of one person; each is its own consent record and absent when its gate is off. */
export function PersonSwitches({
  person,
  handlers,
  disabled,
}: {
  person: PersonEntry;
  handlers: PersonHandlers;
  disabled: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const { account } = person;
  // Without an account there is nothing to switch: "Konto verknüpfen" is the row action.
  if (!account) return null;
  const id = (name: string): string => `person-${person.key}-${name}`;

  const shareOn =
    person.shareConsent !== null
      ? person.shareConsent.status === "accepted" || person.shareConsent.status === "pending"
      : (person.connection?.mine.tripOffers ?? person.paired?.consent === "accepted");
  // A connection that is still a request cannot carry a switch yet.
  const shareLocked =
    account.kind === "remote" && (person.paired !== null || person.connection?.state !== "active");

  const totals = person.comparison?.mine ?? null;
  const totalsOn = totals !== null && (totals.status === "accepted" || totals.status === "pending");
  // The comparison API asks a LOCAL username. A person on another server gets no way to switch it
  // on from here (their bare username would reach a same-named local account); an existing consent
  // can still be switched off, by its key.
  const totalsShown = account.kind === "local" || totalsOn;

  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-0"
      data-testid={`person-switches-${person.key}`}
    >
      <Switch
        id={id("share")}
        checked={shareOn}
        disabled={disabled || shareLocked}
        label={t(`${NS}.switches.share.label`)}
        onChange={(on) => handlers.toggleShare(person, on)}
      />
      {totalsShown && (
        <div>
          <Switch
            id={id("totals")}
            checked={totalsOn}
            disabled={disabled}
            label={t(`${NS}.switches.totals.label`)}
            onChange={(on) => handlers.toggleTotals(person, on)}
          />
          {totals?.status === "accepted" && (
            <button
              type="button"
              className="t-caption underline"
              disabled={disabled}
              onClick={() => handlers.editTotalsScope(person)}
            >
              {t(`${NS}.switches.editScope`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The row's actions behind one "⋯" (the pattern of the trip's "Mehr" menu): link an account,
 * rename, merge, delete for a companion; end the connection, look at their figures for a person on
 * another server. A row with nothing to do has no menu.
 */
export function PersonMenu({
  person,
  handlers,
  disabled,
  canMerge,
  statsOpen,
  achievementsOpen,
}: {
  person: PersonEntry;
  handlers: PersonHandlers;
  disabled: boolean;
  canMerge: boolean;
  statsOpen: boolean;
  achievementsOpen: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing", "companions"]);
  const { companion, connection, paired, account } = person;

  const entries: OverflowEntry[] = [
    ...(companion
      ? [
          {
            key: "link",
            label:
              account?.kind === "local"
                ? t(`${NS}.actions.changeLink`)
                : t(`${NS}.actions.linkAccount`),
            onSelect: () => handlers.link(person),
          },
          {
            key: "rename",
            label: t("companions:manage.actions.rename"),
            onSelect: () => handlers.rename(person),
          },
          {
            key: "merge",
            label: t("companions:manage.actions.merge"),
            disabled: !canMerge,
            onSelect: () => handlers.merge(person),
          },
        ]
      : []),
    ...(connection?.state === "active" && connection.theirs.stats !== "off"
      ? [
          {
            key: "stats",
            label: statsOpen ? t(`${NS}.actions.closeStats`) : t(`${NS}.actions.viewStats`),
            onSelect: () => handlers.toggleStats(person),
          },
        ]
      : []),
    ...(connection?.state === "active" && connection.theirs.achievements
      ? [
          {
            key: "achievements",
            label: achievementsOpen
              ? t(`${NS}.actions.closeAchievements`)
              : t(`${NS}.actions.viewAchievements`),
            onSelect: () => handlers.toggleAchievements(person),
          },
        ]
      : []),
    // Across servers only: on one server the bulk link would show the caller the other account's
    // trips (Codex P1). The person links the offers in their own inbox.
    ...(connection?.state === "active" && connection.theirs.tripOffers
      ? [
          {
            key: "bulkLink",
            label: t(`${NS}.actions.bulkOffer`),
            onSelect: () => handlers.bulkLink(person),
          },
        ]
      : []),
    ...(connection
      ? [
          {
            key: "end",
            label: t(`${NS}.actions.endConnection`),
            danger: true,
            onSelect: () => handlers.endConnection(person),
          },
        ]
      : []),
    ...(paired?.consent === "accepted"
      ? [
          {
            key: "withdraw",
            label: t(`${NS}.actions.withdrawPaired`),
            danger: true,
            onSelect: () => handlers.withdrawPaired(person),
          },
        ]
      : []),
    ...(person.incomingConsent
      ? [
          {
            key: "withdrawIncoming",
            label: t(`${NS}.actions.withdrawIncoming`),
            danger: true,
            onSelect: () => handlers.withdrawIncoming(person),
          },
        ]
      : []),
    ...(companion && !companion.inUse
      ? [
          {
            key: "delete",
            label: t("companions:manage.actions.delete"),
            danger: true,
            onSelect: () => handlers.remove(person),
          },
        ]
      : []),
  ];
  if (entries.length === 0) return null;

  return (
    <OverflowMenu
      entries={entries}
      label={t(`${NS}.menu.label`, { name: person.name })}
      testId={`person-menu-${person.key}`}
      disabled={disabled}
    />
  );
}
