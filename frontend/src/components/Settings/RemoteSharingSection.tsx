import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import type {
  CreatedRemoteInvite,
  RemoteInvite,
  RemotePerson,
  RemoteSharingStatus,
} from "../../types/sharingRemote";
import ReceivedRemoteOffers from "../sharing/ReceivedRemoteOffers";
import { remoteSharingError, type RemoteSharingError } from "../sharing/remoteSharingCopy";
import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { ConfirmDialog, SettingItem } from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useDependency, useDialogCopy, useRowCopy } from "./rowCopy";

const NS = "sharing:remote";

interface Lists {
  invites: RemoteInvite[];
  people: RemotePerson[];
}

/**
 * "Mitreisende auf anderen Servern" (spec 2026-10-20, phase F-S4b): issue a code for someone on
 * another TravStats server and see it once, redeem a code from someone there, and list the people
 * one is paired with and their server; and (F-S4c) answer the trips they offered. Drawn only while the server says the feature is on (the
 * beta key is asked by the caller) — off draws nothing rather than a button that always fails.
 * Every refusal is its own sentence, naming the other server where it matters.
 */
export default function RemoteSharingSection(): JSX.Element | null {
  const { t } = useTranslation(["sharing", "settingsRows"]);
  const row = useRowCopy("sharing");
  const dependency = useDependency();
  const dialog = useDialogCopy();
  const fmt = useDisplayFormat();
  const [status, setStatus] = useState<RemoteSharingStatus | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [listsFailed, setListsFailed] = useState(false);
  /** Bumped after a redeemed code: a trip page's invitation brings its trip offer with it. */
  const [offersVersion, setOffersVersion] = useState(0);
  const [created, setCreated] = useState<CreatedRemoteInvite | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The person whose consent is about to be withdrawn: the confirmation block asks. */
  const [confirming, setConfirming] = useState<RemotePerson | null>(null);

  const load = useCallback(async () => {
    let next: RemoteSharingStatus;
    try {
      next = await sharingRemoteApi.status();
      setStatus(next);
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load cross-server sharing:", error);
      setLoadFailed(true);
      return;
    }
    if (!next.available) return;
    // Failing on its own: the server answered, so the section is drawn, and lists that could
    // not be (re)loaded are said to be so instead of vanishing or standing there stale.
    try {
      const [invites, people] = await Promise.all([
        sharingRemoteApi.listInvites(),
        sharingRemoteApi.listPeople(),
      ]);
      setLists({ invites, people });
      setListsFailed(false);
    } catch (error) {
      logger.error("Failed to load cross-server sharing lists:", error);
      setListsFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, fallbackKey: string): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (error) {
      logger.error("Cross-server sharing action failed:", error);
      setFailure(remoteSharingError(error, fallbackKey));
    } finally {
      setBusy(false);
    }
  };

  const createInvite = (): void =>
    void run(async () => {
      setCreated(await sharingRemoteApi.createInvite());
    }, `${NS}.errors.createFailed`);

  const revoke = (invite: RemoteInvite): void =>
    void run(async () => {
      await sharingRemoteApi.revokeInvite(invite.id);
      if (created?.id === invite.id) setCreated(null);
      setNotice(t(`${NS}.invites.revoked`));
    }, `${NS}.errors.revokeFailed`);

  const withdraw = (person: RemotePerson): void => {
    setConfirming(null);
    void run(async () => {
      await sharingRemoteApi.withdrawPerson(person.id);
      setNotice(t(`${NS}.people.withdrawn`, { name: person.displayName, origin: person.origin }));
    }, `${NS}.errors.withdrawFailed`);
  };

  const claim = (event: FormEvent): void => {
    event.preventDefault();
    const pasted = code.trim();
    if (!pasted) return;
    void run(async () => {
      const person = await sharingRemoteApi.claim(pasted);
      setCode("");
      setOffersVersion((v) => v + 1);
      // A retry of a code this account redeemed already: connected, not an error.
      const key = person.alreadyConnected ? "already" : "done";
      setNotice(t(`${NS}.claim.${key}`, { name: person.displayName, origin: person.origin }));
    }, `${NS}.errors.claimFailed`);
  };

  const copy = row("fcodes");
  const heading = <SectionTitle title={t("settingsRows:sharing.sections.servers")} />;
  if (loadFailed && !status)
    return (
      <SectionCard>
        {heading}
        <SettingRows>
          <SettingItem title={copy.title} error={t(`${NS}.errors.loadFailed`)} />
        </SettingRows>
      </SectionCard>
    );
  if (!status) return null;
  if (!status.available)
    return (
      <SectionCard>
        {heading}
        <SettingRows>
          <SettingItem title={copy.title} sub={copy.sub} dependency={dependency("noFederation")} />
        </SettingRows>
      </SectionCard>
    );

  const ending = confirming ? dialog("shareend", { name: confirming.displayName }) : null;
  return (
    <SectionCard>
      {heading}
      <SettingRows>
        <SettingItem title={copy.title} sub={copy.sub} help={copy.help}>
          <ReceivedRemoteOffers refresh={offersVersion} />

          {listsFailed && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
              <span style={{ color: "var(--ts-warn)" }}>{t(`${NS}.errors.listsFailed`)}</span>
              <Button disabled={busy} onClick={() => void load()}>
                {t(`${NS}.errors.retry`)}
              </Button>
            </div>
          )}

          <div>
            <p className="t-caption mb-3">{t(`${NS}.invites.hint`)}</p>
            <Button variant="primary" disabled={busy} onClick={createInvite}>
              {copy.btn ?? t(`${NS}.invites.create`)}
            </Button>
            {created && (
              <div className="mt-3">
                <Field
                  label={t(`${NS}.invites.codeLabel`)}
                  htmlFor="remote-invite-code"
                  hint={t(`${NS}.invites.codeHint`, { date: fmt.dateTime(created.expiresAt) })}
                >
                  <Input
                    id="remote-invite-code"
                    readOnly
                    value={created.code}
                    onFocus={(e) => e.target.select()}
                  />
                </Field>
              </div>
            )}
            {lists && lists.invites.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {lists.invites.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{t(`${NS}.invites.open`, { date: fmt.dateTime(invite.expiresAt) })}</span>
                    <Button disabled={busy} onClick={() => revoke(invite)}>
                      {t(`${NS}.invites.revoke`)}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={claim} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Field label={t(`${NS}.claim.label`)} htmlFor="remote-claim-code">
                <Input
                  id="remote-claim-code"
                  value={code}
                  placeholder={t(`${NS}.claim.placeholder`)}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={busy || code.trim() === ""}>
              {t(`${NS}.claim.submit`)}
            </Button>
          </form>

          {failure && (
            <p role="alert" className="mb-4 text-sm" style={{ color: "var(--ts-warn)" }}>
              {t(failure.key, { origin: failure.origin })}
            </p>
          )}
          {notice && (
            <p role="status" className="mb-4 text-sm">
              {notice}
            </p>
          )}

          {lists && (
            <div>
              <h3 className="t-label-mono mb-2">{t(`${NS}.people.title`)}</h3>
              {lists.people.length === 0 ? (
                <p className="t-caption">{t(`${NS}.people.none`)}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {lists.people.map((person) => (
                    <li key={person.id} className="flex flex-col gap-1">
                      <span>
                        {t(`${NS}.people.row`, {
                          name: person.displayName,
                          username: person.username,
                          origin: person.origin,
                        })}{" "}
                        ·{" "}
                        <span className="t-caption">
                          {t(`sharing:settings.consents.status.${person.consent}`)}
                        </span>
                      </span>
                      {person.consent === "accepted" && (
                        <span>
                          <Button disabled={busy} onClick={() => setConfirming(person)}>
                            {t(`${NS}.people.withdraw`)}
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SettingItem>
      </SettingRows>
      {confirming && ending && (
        <ConfirmDialog
          open
          {...ending}
          busy={busy}
          onConfirm={() => withdraw(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </SectionCard>
  );
}
