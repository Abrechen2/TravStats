import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type {
  NotificationPreferences,
  ReminderChannel,
  ReminderDomain,
  ReminderDomainPrefs,
} from "../../lib/api";
import { checkCustomLead, customLead, isPreset, REMINDER_DOMAINS } from "./reminderPrefs";

const CHIP_BASE: CSSProperties = {
  minHeight: "var(--ts-size-touch-min)",
  minWidth: "var(--ts-size-touch-min)",
  padding: "0 14px",
  borderRadius: "var(--ts-radius-button)",
  fontSize: 14,
};

interface ChipProps {
  on: boolean;
  disabled?: boolean;
  describedBy?: string;
  onClick: () => void;
  children: ReactNode;
}

function Chip({ on, disabled, describedBy, onClick, children }: ChipProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-describedby={describedBy}
      disabled={disabled}
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

function RowSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center justify-center"
      style={{
        minWidth: "var(--ts-size-touch-min)",
        minHeight: "var(--ts-size-touch-min)",
        background: "transparent",
        border: 0,
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          width: 44,
          height: 26,
          borderRadius: "var(--ts-radius-pill)",
          background: checked ? "var(--ts-accent)" : "var(--ts-surface2)",
          border: `1px solid ${checked ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: "var(--ts-radius-pill)",
            background: checked ? "var(--ts-bg)" : "var(--ts-muted)",
          }}
        />
      </span>
    </button>
  );
}

export interface RemindersTableProps {
  prefs: NotificationPreferences;
  /** Text typed into a domain's custom-hours field and not yet committed. */
  drafts: Partial<Record<ReminderDomain, string>>;
  /** Domains whose last write failed; the row says so and offers a retry. */
  failed: ReadonlySet<ReminderDomain>;
  onChange: (domain: ReminderDomain, patch: Partial<ReminderDomainPrefs>) => void;
  onDraft: (domain: ReminderDomain, text: string | undefined) => void;
  onRetry: (domain: ReminderDomain) => void;
  mailReasonId: string;
  appReasonId: string;
}

function channelWith(channel: ReminderChannel, part: "app" | "mail"): ReminderChannel | null {
  const app = channel !== "mail";
  const mail = channel !== "app";
  const next = { app: part === "app" ? !app : app, mail: part === "mail" ? !mail : mail };
  // A reminder that goes nowhere is the switch's job, not a channel's.
  if (!next.app && !next.mail) return null;
  return next.app && next.mail ? "both" : next.app ? "app" : "mail";
}

export default function RemindersTable(props: RemindersTableProps): JSX.Element {
  const { prefs, drafts, failed, onChange, onDraft, onRetry, mailReasonId, appReasonId } = props;
  const { t } = useTranslation(["settings"]);
  const appBlocked = !prefs.push.available && prefs.push.reason === "no_device_token";
  const mailBlocked = !prefs.mail.available;

  return (
    <div className="@container" data-testid="reminders-table">
      <table className="block w-full @min-[700px]:table" style={{ borderCollapse: "collapse" }}>
        <thead className="hidden @min-[700px]:table-header-group">
          <tr className="t-caption" style={{ textAlign: "left" }}>
            <th scope="col" style={{ padding: "8px 8px 8px 0" }}>
              {t("settings:notifications.table.area")}
            </th>
            <th scope="col" style={{ padding: 8 }}>
              {t("settings:notifications.table.on")}
            </th>
            <th scope="col" style={{ padding: 8 }}>
              {t("settings:notifications.table.when")}
            </th>
            <th scope="col" style={{ padding: 8 }}>
              {t("settings:notifications.table.where")}
            </th>
          </tr>
        </thead>
        <tbody className="block @min-[700px]:table-row-group">
          {REMINDER_DOMAINS.map((domain) => {
            const row = prefs.domains[domain];
            const name = t(`settings:notifications.domains.${domain}.name`);
            const custom = customLead(row.leadHours);
            const draft = drafts[domain];
            const customOn = draft !== undefined || custom !== null;
            const draftCheck = draft !== undefined ? checkCustomLead(draft) : null;
            const draftInvalid = draftCheck !== null && !draftCheck.ok;
            const errorId = `reminder-${domain}-error`;
            const toggleLead = (hours: number): void => {
              const has = row.leadHours.includes(hours);
              const next = has
                ? row.leadHours.filter((h) => h !== hours)
                : [...row.leadHours, hours];
              onChange(domain, { leadHours: next.sort((a, b) => b - a) });
            };
            const toggleCustom = (): void => {
              if (customOn) {
                onDraft(domain, undefined);
                if (custom !== null) {
                  onChange(domain, { leadHours: row.leadHours.filter(isPreset) });
                }
              } else {
                onDraft(domain, "");
              }
            };
            const commitDraft = (): void => {
              if (draft === undefined) return;
              const check = checkCustomLead(draft);
              if (!check.ok) return; // stays open with its message
              onDraft(domain, undefined);
              if (check.hours === custom) return;
              onChange(domain, {
                leadHours: [...row.leadHours.filter(isPreset), check.hours].sort((a, b) => b - a),
              });
            };
            const toggleChannel = (part: "app" | "mail"): void => {
              const next = channelWith(row.channel, part);
              if (next) onChange(domain, { channel: next });
            };
            return (
              <tr
                key={domain}
                data-domain={domain}
                className="grid grid-cols-[1fr_auto] items-center @min-[700px]:table-row"
                style={{ borderTop: "1px solid var(--ts-border)", verticalAlign: "top" }}
              >
                <th
                  scope="row"
                  className="@min-[700px]:table-cell"
                  style={{ padding: "8px 8px 8px 0", textAlign: "left" }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
                    {name}
                  </span>
                  <span className="t-caption block" style={{ fontWeight: 400 }}>
                    {t(`settings:notifications.domains.${domain}.what`)}
                  </span>
                  {failed.has(domain) && (
                    <span
                      role="alert"
                      className="t-caption flex flex-wrap items-center"
                      style={{ gap: 8, color: "var(--ts-danger, #c0392b)" }}
                    >
                      {t("settings:notifications.rowFailed")}
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => onRetry(domain)}
                      >
                        {t("settings:notifications.retry")}
                      </button>
                    </span>
                  )}
                </th>
                <td className="@min-[700px]:table-cell" style={{ padding: 8 }}>
                  <RowSwitch
                    checked={row.enabled}
                    label={t("settings:notifications.rowSwitch", { area: name })}
                    onChange={(enabled) => onChange(domain, { enabled })}
                  />
                </td>
                <td className="col-span-2 @min-[700px]:table-cell" style={{ padding: 8 }}>
                  <span className="t-caption block @min-[700px]:hidden" aria-hidden="true">
                    {t("settings:notifications.table.when")}
                  </span>
                  <div
                    role="group"
                    aria-label={t("settings:notifications.whenGroup", { area: name })}
                    className="flex flex-wrap items-center"
                    style={{ gap: 8 }}
                  >
                    <Chip
                      on={row.leadHours.includes(24)}
                      disabled={!row.enabled}
                      onClick={() => toggleLead(24)}
                    >
                      {t("settings:notifications.lead24")}
                    </Chip>
                    <Chip
                      on={row.leadHours.includes(2)}
                      disabled={!row.enabled}
                      onClick={() => toggleLead(2)}
                    >
                      {t("settings:notifications.lead2")}
                    </Chip>
                    <Chip on={customOn} disabled={!row.enabled} onClick={toggleCustom}>
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
                          style={{ width: 84, minHeight: "var(--ts-size-touch-min)" }}
                          aria-label={t("settings:notifications.customHours", { area: name })}
                          aria-invalid={draftInvalid}
                          aria-describedby={draftInvalid ? errorId : undefined}
                          disabled={!row.enabled}
                          value={draft ?? String(custom ?? "")}
                          onChange={(e) => onDraft(domain, e.target.value)}
                          onBlur={commitDraft}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitDraft();
                          }}
                        />
                        <span className="t-caption">{t("settings:notifications.hoursBefore")}</span>
                      </span>
                    )}
                  </div>
                  {draftCheck && !draftCheck.ok && (
                    <span id={errorId} role="alert" className="t-caption block">
                      {t(`settings:notifications.customInvalid.${draftCheck.reason}`)}
                    </span>
                  )}
                </td>
                <td className="col-span-2 @min-[700px]:table-cell" style={{ padding: 8 }}>
                  <span className="t-caption block @min-[700px]:hidden" aria-hidden="true">
                    {t("settings:notifications.table.where")}
                  </span>
                  <div
                    role="group"
                    aria-label={t("settings:notifications.whereGroup", { area: name })}
                    className="flex flex-wrap items-center"
                    style={{ gap: 8 }}
                  >
                    <Chip
                      on={row.channel !== "mail"}
                      disabled={!row.enabled || (appBlocked && row.channel === "mail")}
                      describedBy={appBlocked ? appReasonId : undefined}
                      onClick={() => toggleChannel("app")}
                    >
                      {t("settings:notifications.channelApp")}
                    </Chip>
                    <Chip
                      on={row.channel !== "app"}
                      disabled={!row.enabled || (mailBlocked && row.channel === "app")}
                      describedBy={mailBlocked ? mailReasonId : undefined}
                      onClick={() => toggleChannel("mail")}
                    >
                      {t("settings:notifications.channelMail")}
                    </Chip>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
