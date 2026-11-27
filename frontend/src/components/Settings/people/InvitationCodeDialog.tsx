import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import { useDisplayFormat } from "../../../lib/format";
import { logger } from "../../../lib/logger";
import type { CreatedRemoteInvite, RemoteInvite } from "../../../types/sharingRemote";
import { remoteSharingError, type RemoteSharingError } from "../../sharing/remoteSharingCopy";
import Button from "../../ui/Button";
import Dialog from "../../ui/Dialog";
import { Field, Input } from "../../ui/Field";
import InlineError from "../../ui/InlineError";

const NS = "sharing:remote";

/**
 * The invitation code, behind the small link under the remote field: make a single-use code for
 * someone on another server (shown once, open ones listed and revocable) and redeem somebody
 * else's. The same calls the old "Mit anderen Servern" block made.
 */
export default function InvitationCodeDialog({
  onClose,
  onClaimed,
}: {
  onClose: () => void;
  /** A redeemed code brings a person (and maybe a trip offer): the caller reloads. */
  onClaimed: () => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const fmt = useDisplayFormat();
  const [invites, setInvites] = useState<RemoteInvite[] | null>(null);
  const [created, setCreated] = useState<CreatedRemoteInvite | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvites(await sharingRemoteApi.listInvites());
    } catch (error) {
      logger.warn("Settings people: could not load the open invitation codes", error);
      setFailure(remoteSharingError(error, `${NS}.errors.listsFailed`));
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
      logger.warn("Settings people: an invitation code action failed", error);
      setFailure(remoteSharingError(error, fallbackKey));
    } finally {
      setBusy(false);
    }
  };

  const claim = (event: FormEvent): void => {
    event.preventDefault();
    const pasted = code.trim();
    if (!pasted) return;
    void run(async () => {
      const person = await sharingRemoteApi.claim(pasted);
      setCode("");
      onClaimed();
      const key = person.alreadyConnected ? "already" : "done";
      setNotice(t(`${NS}.claim.${key}`, { name: person.displayName, origin: person.origin }));
    }, `${NS}.errors.claimFailed`);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("sharing:friends.code.title")}
      dismissLabel={t("sharing:friends.code.close")}
      closeLabel={t("sharing:friends.code.close")}
      busy={busy}
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <p className="t-caption">{t("sharing:friends.code.hint")}</p>
          <div>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setCreated(await sharingRemoteApi.createInvite());
                }, `${NS}.errors.createFailed`)
              }
            >
              {t("sharing:friends.code.create")}
            </Button>
          </div>
          {created && (
            <Field
              label={t("sharing:friends.code.created")}
              htmlFor="friends-invite-code"
              hint={t(`${NS}.invites.codeHint`, { date: fmt.dateTime(created.expiresAt) })}
            >
              <Input
                id="friends-invite-code"
                readOnly
                value={created.code}
                onFocus={(e) => e.target.select()}
              />
            </Field>
          )}
          {invites && invites.length > 0 && (
            <ul className="flex flex-col gap-2">
              {invites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t(`${NS}.invites.open`, { date: fmt.dateTime(invite.expiresAt) })}</span>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await sharingRemoteApi.revokeInvite(invite.id);
                        if (created?.id === invite.id) setCreated(null);
                        setNotice(t(`${NS}.invites.revoked`));
                      }, `${NS}.errors.revokeFailed`)
                    }
                  >
                    {t(`${NS}.invites.revoke`)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form onSubmit={claim} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Field
              label={t(`${NS}.claim.label`)}
              htmlFor="friends-claim-code"
              hint={t("sharing:friends.code.claimHelp")}
            >
              <Input
                id="friends-claim-code"
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
          <InlineError tone="warning">{t(failure.key, { origin: failure.origin })}</InlineError>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </Dialog>
  );
}
