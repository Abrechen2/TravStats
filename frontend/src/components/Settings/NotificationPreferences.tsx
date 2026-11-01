import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import {
  notificationsApi,
  type NotificationPreferences,
  type ReminderDomain,
  type ReminderDomainPrefs,
} from "../../lib/api";
import { logger } from "../../lib/logger";
import {
  Dependency,
  InputControl,
  SettingItem,
  StatusValue,
  useSettingWrite,
} from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { SectionCard, SectionTitle } from "./SettingsShared";
import ReminderRow from "./ReminderRow";
import { REMINDER_DOMAINS } from "./reminderPrefs";
import { useDependency, useRowCopy } from "./rowCopy";

/**
 * Reminders (design §4 A2), two sections: "Wohin" (the address, and whether the
 * app can be reached at all) and "Vor der Abreise" (one row per area).
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
  const { isEnabled } = useEnabledDomains();
  const isDemo = useIsDemoAccount();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "failed">("loading");
  // The address as typed, until the field is left.
  const [emailDraft, setEmailDraft] = useState<string | null>(null);

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

  const email = useSettingWrite<string | null>(
    "notifications.email",
    prefs?.notificationEmail ?? null,
    async (value) =>
      setPrefs(await notificationsApi.updatePreferences({ notificationEmail: value }))
  );

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

  const commitEmail = (): void => {
    if (emailDraft === null) return;
    const trimmed = emailDraft.trim();
    setEmailDraft(null);
    email.choose(trimmed === "" ? null : trimmed);
  };
  const mailCopy = row("erimail");
  const pushCopy = row("pushstate");
  const noRelay = !prefs.push.available && (prefs.push.reason ?? "no_relay") === "no_relay";
  const pushWords = t(
    `settings:notifications.pushStatus.${prefs.push.available ? "ok" : (prefs.push.reason ?? "no_relay")}`
  );
  const lock = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <SectionCard>
        <SectionTitle title={t("settingsRows:notifications.sections.channel")} />
        <SettingRows>
          <SettingItem
            title={mailCopy.title}
            sub={mailCopy.sub}
            save={email}
            locked={lock}
            control={
              <span
                onBlur={commitEmail}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEmail();
                }}
              >
                <InputControl
                  type="email"
                  value={emailDraft ?? email.value ?? ""}
                  onChange={setEmailDraft}
                  placeholder="name@example.com"
                />
              </span>
            }
          />
          <SettingItem
            title={pushCopy.title}
            help={pushCopy.help}
            control={<StatusValue>{pushWords}</StatusValue>}
          >
            {noRelay ? <Dependency reason={dependency("noPush").reason} /> : null}
          </SettingItem>
        </SettingRows>
      </SectionCard>
      <SectionCard>
        <SectionTitle title={t("settingsRows:notifications.sections.domains")} />
        <SettingRows>
          {/* A server older than this web build sends no row for the newer areas; draw none rather than crash. */}
          {REMINDER_DOMAINS.filter((domain) => prefs.domains[domain] !== undefined).map(
            (domain) => (
              <ReminderRow
                key={domain}
                domain={domain}
                saved={prefs.domains[domain]}
                push={prefs.push}
                mail={prefs.mail}
                domainOn={isEnabled(domain)}
                locked={isDemo}
                write={writeDomain}
              />
            )
          )}
        </SettingRows>
        <p className="t-caption">{t("settings:notifications.carriedOver")}</p>
      </SectionCard>
    </div>
  );
}
