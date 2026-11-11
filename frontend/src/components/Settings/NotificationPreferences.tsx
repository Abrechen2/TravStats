import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import {
  notificationsApi,
  type NotificationPreferences,
  type ReminderChannel,
  type ReminderDomain,
  type ReminderDomainPrefs,
} from "../../lib/api";
import { logger } from "../../lib/logger";
import {
  ChoiceControl,
  Dependency,
  SettingItem,
  StatusValue,
  useGuardedNavigate,
  useSettingWrite,
  type ChoiceOption,
} from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { SectionCard, SectionTitle } from "./SettingsShared";
import ReminderRow from "./ReminderRow";
import { PushStateView } from "./PushStateRow";
import { REMINDER_DOMAINS } from "./reminderPrefs";
import { useDependency, useRowCopy } from "./rowCopy";

/** The channel row's value while the areas disagree. */
const MIXED = "mixed";

/**
 * Reminders (settings v3), two sections: "Wohin" (the address, ONE channel for
 * every area, and whether the app can be reached at all) and "Vor der Abreise"
 * (one lead select per area that is switched on).
 *
 * Every row writes at once and keeps the user's pick when the server refuses
 * (B6). The page is never drawn from defaults while the server could not be
 * read: showing "off" for switches that may be on, and then saving over them,
 * is the lie the failed-load state exists to avoid.
 */
export default function NotificationPreferencesCards(): JSX.Element {
  const { t } = useTranslation(["settings", "common", "settingsRows"]);
  const row = useRowCopy("notifications");
  const dependency = useDependency();
  const go = useGuardedNavigate();
  const { isEnabled } = useEnabledDomains();
  const isDemo = useIsDemoAccount();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "failed">("loading");

  const load = useCallback(async (): Promise<void> => {
    setLoadState("loading");
    try {
      setPrefs(await notificationsApi.getPreferences());
      setLoadState("loaded");
    } catch (error) {
      logger.error("Loading the reminder preferences failed:", error);
      setLoadState("failed");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const writeDomain = useCallback(
    async (domain: ReminderDomain, value: ReminderDomainPrefs): Promise<void> => {
      const updated = await notificationsApi.updatePreferences({ domains: { [domain]: value } });
      // Only this area's row (and the channel availability): rows are written
      // independently, so an answer to one must not undo another's confirmed state.
      setPrefs((current) =>
        current
          ? {
              ...current,
              domains: { ...current.domains, [domain]: updated.domains[domain] },
              mail: updated.mail,
              push: updated.push,
            }
          : updated
      );
    },
    []
  );

  const channels = prefs ? channelsOf(prefs) : [];
  const sharedChannel = channels.length > 0 && channels.every((c) => c === channels[0]);
  // One channel for every area: the server stores one per area, so the pick is
  // written to all of them in ONE request.
  const channel = useSettingWrite<ReminderChannel | typeof MIXED>(
    "notifications.channel",
    sharedChannel ? channels[0] : MIXED,
    async (value) => {
      if (value === MIXED || !prefs) return;
      const areas = REMINDER_DOMAINS.filter((d) => prefs.domains[d] !== undefined);
      const updated = await notificationsApi.updatePreferences({
        domains: Object.fromEntries(areas.map((d) => [d, { channel: value }])),
      });
      setPrefs((current) =>
        current
          ? {
              ...current,
              domains: {
                ...current.domains,
                ...Object.fromEntries(
                  areas.map((d) => [
                    d,
                    { ...current.domains[d], channel: updated.domains[d]?.channel ?? value },
                  ])
                ),
              },
              mail: updated.mail,
              push: updated.push,
            }
          : updated
      );
    }
  );

  if (loadState === "failed") {
    return (
      <SectionCard>
        <div role="alert">
          <p className="t-caption">{t("settings:notifications.loadError")}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            {t("common:buttons.retry")}
          </button>
        </div>
      </SectionCard>
    );
  }
  if (loadState === "loading" || !prefs) {
    return <p className="t-caption">{t("common:messages.loading")}</p>;
  }

  const addrCopy = row("erimail");
  const channelCopy = row("rchan");
  const pushCopy = row("pushstate");
  const noRelay = !prefs.push.available && (prefs.push.reason ?? "no_relay") === "no_relay";
  const appBlocked = !prefs.push.available && prefs.push.reason === "no_device_token";
  const mailBlocked = !prefs.mail.available;
  const lock = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const picked = channel.value;
  const reachesApp = picked === "app" || picked === "both";
  const reachesMail = picked === "mail" || picked === "both";
  // An option that would add a channel nothing can reach stays off, the current one stays.
  const option = (value: ReminderChannel, label: string): ChoiceOption<ReminderChannel> => {
    const needsApp = value !== "mail";
    const needsMail = value !== "app";
    return {
      value,
      label,
      disabled: value !== picked && ((needsApp && appBlocked) || (needsMail && mailBlocked)),
    };
  };
  const areas = REMINDER_DOMAINS.filter(
    // A server older than this web build sends no row for the newer areas; an
    // area that is switched off has no reminders, so it has no row.
    (domain) => prefs.domains[domain] !== undefined && isEnabled(domain)
  );

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <SectionCard>
        <SectionTitle title={t("settingsRows:notifications.sections.channel")} />
        <SettingRows>
          <SettingItem
            title={addrCopy.title}
            sub={addrCopy.sub}
            control={
              <StatusValue>
                {prefs.notificationEmail ?? t("settingsRows:notifications.remaddr.none")}
              </StatusValue>
            }
          >
            {prefs.notificationEmail === null ? (
              <Dependency
                reason={dependency("noMailAddr").reason}
                jump={{
                  label: t("settingsRows:notifications.remaddr.jump"),
                  onJump: () => go("/settings/profil"),
                }}
              />
            ) : null}
          </SettingItem>
          <SettingItem
            title={channelCopy.title}
            sub={picked === MIXED ? t("settingsRows:notifications.rchan.mixed") : channelCopy.sub}
            save={channel}
            locked={lock}
            control={
              <ChoiceControl<ReminderChannel | typeof MIXED>
                label={channelCopy.title}
                value={picked}
                options={[
                  option("app", t("settings:notifications.channelApp")),
                  option("mail", t("settings:notifications.channelMail")),
                  option("both", t("settingsRows:notifications.rchan.both")),
                ]}
                onChange={(next) => {
                  if (next !== MIXED) channel.choose(next);
                }}
              />
            }
          >
            {reachesApp && noRelay ? <Dependency reason={dependency("noPush").reason} /> : null}
            {(reachesMail || picked === MIXED) && mailBlocked ? (
              <Dependency reason={dependency("noMailAddr").reason} />
            ) : null}
            {appBlocked ? (
              <Dependency reason={t("settings:notifications.pushStatus.no_device_token")} />
            ) : null}
          </SettingItem>
          <PushStateView push={prefs.push} title={pushCopy.title} help={pushCopy.help} />
        </SettingRows>
      </SectionCard>
      <SectionCard>
        <SectionTitle title={t("settingsRows:notifications.sections.domains")} />
        <SettingRows>
          {areas.map((domain) => (
            <ReminderRow
              key={domain}
              domain={domain}
              saved={prefs.domains[domain]}
              locked={isDemo}
              write={writeDomain}
            />
          ))}
        </SettingRows>
        <p className="t-caption">{t("settings:notifications.carriedOver")}</p>
      </SectionCard>
    </div>
  );
}

/** The channel of every area the server sent. */
function channelsOf(prefs: NotificationPreferences): ReminderChannel[] {
  return REMINDER_DOMAINS.flatMap((d) => (prefs.domains[d] ? [prefs.domains[d].channel] : []));
}
