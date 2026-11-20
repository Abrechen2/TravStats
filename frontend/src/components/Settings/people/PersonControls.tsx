import type { JSX, ReactNode } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { Switch } from "../../ui/Field";
import type { PersonEntry } from "./buildPeople";

/** What the row's controls ask the section to do; the section owns every call and its failure. */
export interface PersonHandlers {
  toggleShare: (p: PersonEntry, on: boolean) => void;
  toggleTotals: (p: PersonEntry, on: boolean) => void;
  editTotalsScope: (p: PersonEntry) => void;
  toggleEncrypted: (p: PersonEntry, on: boolean) => void;
  link: (p: PersonEntry) => void;
  rename: (p: PersonEntry) => void;
  merge: (p: PersonEntry) => void;
  remove: (p: PersonEntry) => void;
  endConnection: (p: PersonEntry) => void;
  withdrawPaired: (p: PersonEntry) => void;
  toggleStats: (p: PersonEntry) => void;
  toggleAchievements: (p: PersonEntry) => void;
}

const NS = "sharing:friends";

/** The switches of one person; each is its own consent record and absent when its gate is off. */
export function PersonSwitches({
  person,
  handlers,
  disabled,
  gates,
}: {
  person: PersonEntry;
  handlers: PersonHandlers;
  disabled: boolean;
  gates: { comparison: boolean; encryptedShare: boolean };
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
  const shareAsked = person.shareConsent?.status === "pending";
  // A connection that is still a request cannot carry a switch yet.
  const shareLocked =
    account.kind === "remote" && (person.paired !== null || person.connection?.state !== "active");

  const totals = person.comparison?.mine ?? null;
  const totalsOn = totals !== null && (totals.status === "accepted" || totals.status === "pending");
  // On another server a leaderboard consent only exists once the comparison knows the person.
  const totalsShown = gates.comparison && (account.kind === "local" || person.comparison !== null);

  const grant = person.encryptedLink?.grants.find((g) => g.active && g.audience === "");
  const encryptedShown =
    gates.encryptedShare &&
    person.encryptedLink !== null &&
    person.encryptedLink.confirmed &&
    person.encryptedLink.remoteConfirmed;

  return (
    <div className="mt-2 flex flex-col gap-1" data-testid={`person-switches-${person.key}`}>
      <Switch
        id={id("share")}
        checked={shareOn}
        disabled={disabled || shareLocked}
        label={t(`${NS}.switches.share.label`)}
        sub={shareAsked ? t(`${NS}.switches.shareAsked`) : t(`${NS}.switches.share.sub`)}
        onChange={(on) => handlers.toggleShare(person, on)}
      />
      {totalsShown && (
        <div>
          <Switch
            id={id("totals")}
            checked={totalsOn}
            disabled={disabled}
            label={t(`${NS}.switches.totals.label`)}
            sub={
              totals?.status === "pending"
                ? t(`${NS}.switches.totalsAsked`)
                : t(`${NS}.switches.totals.sub`)
            }
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
      {encryptedShown && (
        <Switch
          id={id("encrypted")}
          checked={grant !== undefined}
          disabled={disabled}
          label={t(`${NS}.switches.encrypted.label`)}
          sub={
            grant === undefined
              ? t(`${NS}.switches.encryptedRedirect`)
              : t(`${NS}.switches.encrypted.sub`)
          }
          onChange={(on) => handlers.toggleEncrypted(person, on)}
        />
      )}
    </div>
  );
}

/** A small row action: text, underlined, no frame. */
function LinkButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" className="t-caption underline" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** The small row actions: link an account, rename, merge, delete; a remote person can end. */
export function PersonActions({
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
}): JSX.Element {
  const { t } = useTranslation(["sharing", "companions"]);
  const { companion, connection, paired, account } = person;
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1"
      data-testid={`person-actions-${person.key}`}
    >
      {companion && (
        <>
          <LinkButton disabled={disabled} onClick={() => handlers.link(person)}>
            {account?.kind === "local"
              ? t(`${NS}.actions.changeLink`)
              : t(`${NS}.actions.linkAccount`)}
          </LinkButton>
          <LinkButton disabled={disabled} onClick={() => handlers.rename(person)}>
            {t("companions:manage.actions.rename")}
          </LinkButton>
          <LinkButton disabled={disabled || !canMerge} onClick={() => handlers.merge(person)}>
            {t("companions:manage.actions.merge")}
          </LinkButton>
          {!companion.inUse && (
            <LinkButton disabled={disabled} onClick={() => handlers.remove(person)}>
              {t("companions:manage.actions.delete")}
            </LinkButton>
          )}
        </>
      )}
      {connection?.state === "active" && connection.theirs.stats !== "off" && (
        <LinkButton onClick={() => handlers.toggleStats(person)}>
          {statsOpen ? t(`${NS}.actions.closeStats`) : t(`${NS}.actions.viewStats`)}
        </LinkButton>
      )}
      {connection?.state === "active" && connection.theirs.achievements && (
        <LinkButton onClick={() => handlers.toggleAchievements(person)}>
          {achievementsOpen
            ? t(`${NS}.actions.closeAchievements`)
            : t(`${NS}.actions.viewAchievements`)}
        </LinkButton>
      )}
      {connection && (
        <LinkButton disabled={disabled} onClick={() => handlers.endConnection(person)}>
          {t(`${NS}.actions.endConnection`)}
        </LinkButton>
      )}
      {paired?.consent === "accepted" && (
        <LinkButton disabled={disabled} onClick={() => handlers.withdrawPaired(person)}>
          {t(`${NS}.actions.withdrawPaired`)}
        </LinkButton>
      )}
    </div>
  );
}
