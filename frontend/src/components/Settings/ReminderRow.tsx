import { useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import type {
  NotificationPreferences,
  ReminderChannel,
  ReminderDomain,
  ReminderDomainPrefs,
} from "../../lib/api";
import {
  Dependency,
  ErrorLine,
  SettingItem,
  SwitchControl,
  useGuardedNavigate,
  useSettingWrite,
} from "../ui/settings";
import { checkCustomLead, customLead, isPreset } from "./reminderPrefs";
import { useDependency, useRowCopy } from "./rowCopy";

const CHIP_BASE: CSSProperties = {
  minHeight: "var(--ts-size-touch-min)",
  minWidth: "var(--ts-size-touch-min)",
  padding: "0 14px",
  borderRadius: "var(--ts-radius-button)",
  fontSize: 14,
};

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={onClick}
      style={{
        ...CHIP_BASE,
        border: `2px solid ${on ? "var(--ts-accent)" : "var(--ts-border)"}`,
        background: on ? "var(--ts-surface2)" : "var(--ts-surface)",
        color: on ? "var(--ts-text-bright)" : "var(--ts-text)",
        fontWeight: on ? 800 : 500,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function channelWith(channel: ReminderChannel, part: "app" | "mail"): ReminderChannel | null {
  const app = channel !== "mail";
  const mail = channel !== "app";
  const next = { app: part === "app" ? !app : app, mail: part === "mail" ? !mail : mail };
  // A reminder that goes nowhere is the switch's job, not a channel's.
  if (!next.app && !next.mail) return null;
  return next.app && next.mail ? "both" : next.app ? "app" : "mail";
}

interface ReminderRowProps {
  domain: ReminderDomain;
  /** What the server holds for this area. */
  saved: ReminderDomainPrefs;
  push: NotificationPreferences["push"];
  mail: NotificationPreferences["mail"];
  /** Is the area switched on (Reisearten)? The server never announces one that is off. */
  domainOn: boolean;
  locked: boolean;
  /** Send this area's whole row; resolves once the server confirmed it. */
  write: (domain: ReminderDomain, row: ReminderDomainPrefs) => Promise<void>;
}

/**
 * One area of "Vor der Abreise" (design §4 A2): ON/off, lead times (24 h, 2 h
 * and one own time of whole hours 1-168) and where the reminder goes. The row
 * is one write: every chip keeps the user's pick when the server refuses, says
 * so with "Erneut versuchen" / "Verwerfen", and a pick made while a write is
 * open is sent after it, never before.
 */
export default function ReminderRow({
  domain,
  saved,
  push,
  mail,
  domainOn,
  locked,
  write,
}: ReminderRowProps): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const copyOf = useRowCopy("notifications");
  const dependency = useDependency();
  const go = useGuardedNavigate();
  const coarse = useCoarsePointer();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const w = useSettingWrite<ReminderDomainPrefs>(`notifications.${domain}`, saved, (value) =>
    write(domain, value)
  );
  const copy = copyOf(`r_${domain}`);
  const row = w.value;
  const name = copy.title;

  const custom = customLead(row.leadHours);
  const customOn = draft !== undefined || custom !== null;
  const check = draft !== undefined ? checkCustomLead(draft) : null;
  const invalid = check !== null && !check.ok;
  const errorId = `reminder-${domain}-error`;
  const appBlocked = !push.available && push.reason === "no_device_token";
  const mailBlocked = !mail.available;
  const lock = locked
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const choose = (patch: Partial<ReminderDomainPrefs>): void => w.choose({ ...row, ...patch });

  const toggleLead = (hours: number): void => {
    const next = row.leadHours.includes(hours)
      ? row.leadHours.filter((h) => h !== hours)
      : [...row.leadHours, hours];
    choose({ leadHours: next.sort((a, b) => b - a) });
  };
  const toggleCustom = (): void => {
    if (customOn) {
      setDraft(undefined);
      if (custom !== null) choose({ leadHours: row.leadHours.filter(isPreset) });
    } else {
      setDraft("");
    }
  };
  const commitDraft = (): void => {
    if (draft === undefined) return;
    const result = checkCustomLead(draft);
    if (!result.ok) return; // stays open with its message
    setDraft(undefined);
    if (result.hours === custom) return;
    choose({ leadHours: [...row.leadHours.filter(isPreset), result.hours].sort((a, b) => b - a) });
  };
  const toggleChannel = (part: "app" | "mail"): void => {
    const next = channelWith(row.channel, part);
    if (next) choose({ channel: next });
  };

  if (!domainOn) {
    return (
      <SettingItem
        title={name}
        sub={t(`settings:notifications.domains.${domain}.what`)}
        dependency={{
          reason: t("settings:notifications.domainOff", { area: name }),
          jump: {
            label: t("settings:notifications.domainOffAction"),
            onJump: () => go("/settings/domains"),
          },
        }}
      />
    );
  }

  return (
    <SettingItem
      title={name}
      sub={t(`settings:notifications.domains.${domain}.what`)}
      help={copy.help}
      save={w}
      locked={lock}
      control={
        <SwitchControl
          checked={row.enabled}
          onChange={(enabled) => choose({ enabled })}
          label={t("settings:notifications.rowSwitch", { area: name })}
        />
      }
    >
      <div
        role="group"
        aria-label={t("settings:notifications.whenGroup", { area: name })}
        className="flex flex-wrap items-center"
        style={{ gap: 8 }}
      >
        <Chip
          on={row.leadHours.includes(24)}
          disabled={!row.enabled || locked}
          onClick={() => toggleLead(24)}
        >
          {t("settings:notifications.lead24")}
        </Chip>
        <Chip
          on={row.leadHours.includes(2)}
          disabled={!row.enabled || locked}
          onClick={() => toggleLead(2)}
        >
          {t("settings:notifications.lead2")}
        </Chip>
        <Chip on={customOn} disabled={!row.enabled || locked} onClick={toggleCustom}>
          {t("settings:notifications.leadCustom")}
        </Chip>
        {customOn && (
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={168}
              step={1}
              className="input"
              style={{ width: 84, minHeight: coarse ? "var(--ts-size-touch-min)" : undefined }}
              aria-label={t("settings:notifications.customHours", { area: name })}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              disabled={!row.enabled || locked}
              value={draft ?? String(custom ?? "")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraft();
              }}
            />
            <span className="t-caption">{t("settings:notifications.hoursBefore")}</span>
          </span>
        )}
      </div>
      {check && !check.ok && (
        <ErrorLine id={errorId}>
          {t(`settings:notifications.customInvalid.${check.reason}`)}
        </ErrorLine>
      )}
      <div
        role="group"
        aria-label={t("settings:notifications.whereGroup", { area: name })}
        className="flex flex-wrap items-center"
        style={{ gap: 8 }}
      >
        <Chip
          on={row.channel !== "mail"}
          disabled={locked || !row.enabled || (appBlocked && row.channel === "mail")}
          onClick={() => toggleChannel("app")}
        >
          {t("settings:notifications.channelApp")}
        </Chip>
        <Chip
          on={row.channel !== "app"}
          disabled={locked || !row.enabled || (mailBlocked && row.channel === "app")}
          onClick={() => toggleChannel("mail")}
        >
          {t("settings:notifications.channelMail")}
        </Chip>
      </div>
      {row.enabled && row.channel !== "mail" && !push.available && push.reason === "no_relay" ? (
        <Dependency reason={dependency("noPush").reason} />
      ) : null}
      {row.enabled && row.channel !== "app" && mailBlocked ? (
        <Dependency reason={dependency("noMailAddr").reason} />
      ) : null}
    </SettingItem>
  );
}
