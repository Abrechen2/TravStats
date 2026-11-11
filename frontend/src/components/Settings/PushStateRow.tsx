import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { notificationsApi, type NotificationPreferences } from "../../lib/api";
import { logger } from "../../lib/logger";
import { Dependency, SettingItem, StatusValue } from "../ui/settings";
import { useDependency, useRowCopy } from "./rowCopy";

type Push = NotificationPreferences["push"];

/** "Mitteilungen an die App": whether a notification can reach a phone, and why not. */
export function PushStateView({
  push,
  title,
  help,
}: {
  push: Push;
  title: string;
  help?: string;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const dependency = useDependency();
  const reason = push.available ? "ok" : (push.reason ?? "no_relay");
  return (
    <SettingItem
      title={title}
      help={help}
      control={<StatusValue>{t(`settings:notifications.pushStatus.${reason}`)}</StatusValue>}
    >
      {reason === "no_relay" ? <Dependency reason={dependency("noPush").reason} /> : null}
    </SettingItem>
  );
}

/**
 * The same row on the phones page ("Mitteilungen", prototype `pushstate2`),
 * which reads the state itself. An unreadable state is said, never drawn as
 * "ready".
 */
export default function PushStateRow(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const copy = useRowCopy("devices")("pushstate2");
  const [push, setPush] = useState<Push | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const prefs = await notificationsApi.getPreferences();
        if (alive) setPush(prefs.push);
      } catch (error) {
        logger.warn("Failed to load the push state", error);
        if (alive) setFailed(true);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  if (push) return <PushStateView push={push} title={copy.title} help={copy.help} />;
  return (
    <SettingItem
      title={copy.title}
      error={failed ? t("settings:notifications.loadError") : undefined}
      control={<StatusValue>…</StatusValue>}
    />
  );
}
