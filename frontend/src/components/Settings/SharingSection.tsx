import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type {
  LinkableCompanion,
  LinkableCompanionList,
  ShareConsent,
  ShareConsentList,
} from "../../types/sharing";
import { sharingErrorKey } from "../sharing/sharingCopy";
import Button from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";
import { ConfirmDialog, SettingItem } from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useDialogCopy, useRowCopy } from "./rowCopy";

const NS = "sharing:settings";

/**
 * "Reisen teilen" (design 2026-10-09, decision 4): ask another account on
 * this server for consent, see and withdraw consents, and link companions to
 * the accounts that said yes — the companion editor's "mit Konto verknüpfen".
 * Every failure is shown as itself (`sharingErrorKey`), never as a silent
 * no-op; a failed load says so instead of drawing empty lists.
 */
export default function SharingSection(): JSX.Element {
  const { t } = useTranslation(["sharing", "settingsRows", "settings"]);
  const row = useRowCopy("sharing");
  const dialog = useDialogCopy();
  const isDemo = useIsDemoAccount();
  const [ending, setEnding] = useState<ShareConsent | null>(null);
  const addToast = useToastStore((state) => state.addToast);
  const [consents, setConsents] = useState<ShareConsentList | null>(null);
  const [companions, setCompanions] = useState<LinkableCompanionList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([sharingApi.listConsents(), sharingApi.listCompanions()]);
      setConsents(c);
      setCompanions(l);
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load sharing settings:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<string>, fallbackKey: string): Promise<void> => {
    setBusy(true);
    try {
      addToast("success", await action());
      await load();
    } catch (error) {
      logger.error("Sharing settings action failed:", error);
      addToast("error", t(sharingErrorKey(error, fallbackKey)));
    } finally {
      setBusy(false);
    }
  };

  const request = (event: FormEvent): void => {
    event.preventDefault();
    const name = username.trim();
    if (!name) return;
    void run(async () => {
      const consent = await sharingApi.requestConsent(name);
      setUsername("");
      return t(`${NS}.request.sent`, { name: consent.person.displayName });
    }, `${NS}.errors.requestFailed`);
  };

  const withdraw = (consent: ShareConsent): void => {
    setEnding(null);
    void run(async () => {
      await sharingApi.answerConsent(consent.id, "withdraw");
      return t(`${NS}.consents.withdrawn`);
    }, `${NS}.errors.withdrawFailed`);
  };

  const relink = (companion: LinkableCompanion, userId: string): void => {
    void run(async () => {
      if (!userId) {
        await sharingApi.unlinkCompanion(companion.id);
        return t(`${NS}.companions.unlinked`);
      }
      const linked = await sharingApi.linkCompanion(companion.id, userId);
      return t(`${NS}.companions.linked`, {
        companion: linked.name,
        username: linked.linkedUser?.username ?? "",
      });
    }, `${NS}.errors.linkFailed`);
  };

  const live = (list: ShareConsent[]) => list.filter((c) => c.status !== "withdrawn");

  const requestCopy = row("anfragen");
  const linkCopy = row("verkn");
  const lock = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const end = ending ? dialog("shareend", { name: ending.person.displayName }) : null;

  return (
    <SectionCard>
      <SectionTitle title={t("settingsRows:sharing.sections.accounts")} />
      <SettingRows>
        <SettingItem
          title={requestCopy.title}
          sub={requestCopy.sub}
          help={requestCopy.help}
          locked={lock}
          error={loadFailed ? t(`${NS}.errors.loadFailed`) : undefined}
        >
          <form onSubmit={request} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Field label={t(`${NS}.request.label`)} htmlFor="share-request-username">
                <Input
                  id="share-request-username"
                  value={username}
                  placeholder={t(`${NS}.request.placeholder`)}
                  disabled={isDemo}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={isDemo || busy || username.trim() === ""}
            >
              {t(`${NS}.request.submit`)}
            </Button>
          </form>
          {consents &&
            (live(consents.outgoing).length + live(consents.incoming).length === 0 ? (
              <p className="t-caption">{t(`${NS}.consents.none`)}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {[
                  ...live(consents.outgoing).map((c) => ({ c, dir: "outgoing" as const })),
                  ...live(consents.incoming).map((c) => ({ c, dir: "incoming" as const })),
                ].map(({ c, dir }) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {t(`${NS}.consents.${dir}`, { name: c.person.displayName })} ·{" "}
                      <span className="t-caption">{t(`${NS}.consents.status.${c.status}`)}</span>
                    </span>
                    {(c.status === "pending" || c.status === "accepted") && (
                      <Button
                        disabled={isDemo || busy}
                        // Nothing was shared while a request is still open: no question.
                        onClick={() => (c.status === "accepted" ? setEnding(c) : withdraw(c))}
                      >
                        {t(`${NS}.consents.withdraw`)}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ))}
        </SettingItem>
        <SettingItem title={linkCopy.title} sub={linkCopy.sub} locked={lock}>
          {companions && (
            <>
              <p className="t-caption">
                {companions.linkableUsers.length === 0
                  ? t(`${NS}.companions.noLinkable`)
                  : t(`${NS}.companions.hint`)}
              </p>
              {companions.companions.length === 0 ? (
                <p className="t-caption">{t(`${NS}.companions.none`)}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {companions.companions.map((companion) => (
                    <CompanionLinkRow
                      key={companion.id}
                      companion={companion}
                      users={companions.linkableUsers}
                      disabled={isDemo || busy}
                      onChange={(userId) => relink(companion, userId)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </SettingItem>
      </SettingRows>
      {ending && end && (
        <ConfirmDialog
          open
          {...end}
          busy={busy}
          onConfirm={() => withdraw(ending)}
          onCancel={() => setEnding(null)}
        />
      )}
    </SectionCard>
  );
}

function CompanionLinkRow({
  companion,
  users,
  disabled,
  onChange,
}: {
  companion: LinkableCompanion;
  users: LinkableCompanionList["linkableUsers"];
  disabled: boolean;
  onChange: (userId: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  // The linked account stays selectable even when its consent was withdrawn.
  const options = [
    ...users,
    ...(companion.linkedUser && !users.some((u) => u.id === companion.linkedUser?.id)
      ? [companion.linkedUser]
      : []),
  ];
  const id = `share-link-${companion.id}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id}>{companion.name}</label>
      <Select
        id={id}
        aria-label={`${t(`${NS}.companions.linkLabel`)}: ${companion.name}`}
        value={companion.linkedUser?.id ?? ""}
        disabled={disabled || (options.length === 0 && !companion.linkedUser)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {companion.linkedUser
            ? t(`${NS}.companions.unlink`)
            : `${t(`${NS}.companions.linkLabel`)} — ${t(`${NS}.companions.notLinked`)}`}
        </option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName} (@{u.username})
          </option>
        ))}
      </Select>
    </li>
  );
}
