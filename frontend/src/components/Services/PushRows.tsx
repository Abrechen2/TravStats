import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { pushRelayApi, type PushRelayState } from "../../lib/api";
import { appLocale } from "../../lib/units";
import { todayZoneNow } from "../../hooks/useTodayZone";
import {
  ActionControl,
  ConfirmDialog,
  ErrorLine,
  InputControl,
  SettingItem,
  SettingWriteError,
  StatusValue,
  SwitchControl,
  useSettingWrite,
} from "../ui/settings";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import { useLoaded } from "./useLoaded";
import { useDemoLock } from "./useLockFor";

const PRIVACY_URL = "https://www.abrechen2.de/travstats/datenschutz/";
const when = (iso: string): string =>
  new Date(iso).toLocaleString(appLocale(), { timeZone: todayZoneNow() });

/** Push: the switch with its consent text, the relay address (Expert), and the reset. */
export default function PushRows(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "pushRelay"]);
  const demo = useDemoLock();
  const expert = useExpertRows(1);
  const { data, setData, failed } = useLoaded<PushRelayState>(() => pushRelayApi.get());
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(false);

  const on = useSettingWrite<boolean>("services.push.on", data?.pushEnabled ?? false, async (v) => {
    try {
      setData(await pushRelayApi.update({ pushEnabled: v }));
    } catch {
      throw new SettingWriteError("rejected");
    }
  });
  if (failed) return <ErrorLine>{t("pushRelay:loadFailed")}</ErrorLine>;
  if (!data) return null;

  const commitUrl = async (): Promise<void> => {
    if (url === null || url === data.pushRelayUrl) return;
    try {
      setData(await pushRelayApi.update({ pushRelayUrl: url }));
      setUrl(null);
      setUrlError(false);
    } catch {
      setUrlError(true);
    }
  };
  const pausedUntil =
    data.pausedUntil && new Date(data.pausedUntil).getTime() > Date.now() ? data.pausedUntil : null;

  return (
    <>
      <SettingItem
        title={t("settingsRows:services.rows.pushon.t")}
        sub={t("settingsRows:services.rows.pushon.s")}
        help={t("settingsRows:services.rows.pushon.h")}
        scope="allAccounts"
        locked={demo}
        save={on}
        control={<SwitchControl checked={on.value} onChange={on.choose} />}
      >
        <div className="t-caption flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          <p style={{ margin: 0 }}>{t("pushRelay:explanation.operator")}</p>
          <p style={{ margin: 0 }}>{t("pushRelay:explanation.receives")}</p>
          <p style={{ margin: 0 }}>{t("pushRelay:explanation.stores")}</p>
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline">
            {t("pushRelay:privacyLink")}
          </a>
        </div>
      </SettingItem>
      {data.pushEnabled && data.consentAt ? (
        <SettingItem
          title={t("settingsRows:services.rows.pushconsent.t")}
          help={t("settingsRows:services.rows.pushconsent.h")}
          scope="allAccounts"
          control={<StatusValue>{when(data.consentAt)}</StatusValue>}
        />
      ) : null}
      {expert ? (
        <SettingItem
          title={t("settingsRows:services.rows.pushrelay.t")}
          help={t("settingsRows:services.rows.pushrelay.h")}
          expert
          scope="allAccounts"
          locked={demo}
          error={urlError ? t("pushRelay:invalidUrl") : undefined}
          control={
            <span
              onBlur={() => void commitUrl()}
              onKeyDown={(e) => e.key === "Enter" && void commitUrl()}
            >
              <InputControl type="url" value={url ?? data.pushRelayUrl} onChange={setUrl} />
            </span>
          }
        />
      ) : null}
      <SettingItem
        title={t("settingsRows:services.rows.pushreset.t")}
        sub={data.registered ? t("pushRelay:registered") : t("pushRelay:notRegistered")}
        locked={demo}
        control={
          <ActionControl
            danger
            label={t("settingsRows:services.rows.pushreset.btn")}
            busy={!data.registered && !pausedUntil}
            onClick={() => setResetting(true)}
          />
        }
      >
        {pausedUntil ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t("pushRelay:pausedUntil", { time: when(pausedUntil) })}
          </p>
        ) : null}
      </SettingItem>
      <ConfirmDialog
        open={resetting}
        title={t("settingsRows:services.dialogs.pushreset.title")}
        affects={t("settingsRows:services.dialogs.pushreset.affects")}
        amount={t("settingsRows:services.dialogs.pushreset.amount")}
        after={
          <>
            {t("settingsRows:services.dialogs.pushreset.after")}
            {resetError ? <ErrorLine>{t("settingsRows:services.ui.resetFailed")}</ErrorLine> : null}
          </>
        }
        confirmLabel={t("settingsRows:services.dialogs.pushreset.confirm")}
        onConfirm={() => {
          setResetError(false);
          void pushRelayApi.reset().then(
            (next) => {
              setData(next);
              setResetting(false);
            },
            () => setResetError(true)
          );
        }}
        onCancel={() => setResetting(false)}
      />
    </>
  );
}
