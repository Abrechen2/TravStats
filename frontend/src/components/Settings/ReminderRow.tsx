import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { ReminderDomain, ReminderDomainPrefs } from "../../lib/api";
import { ChoiceControl, SettingItem, useSettingWrite } from "../ui/settings";
import { LEAD_CUSTOM, LEAD_OFF, leadChoiceOf, leadPatch, ownLeadLabel } from "./reminderPrefs";
import { useRowCopy } from "./rowCopy";

interface ReminderRowProps {
  domain: ReminderDomain;
  /** What the server holds for this area. */
  saved: ReminderDomainPrefs;
  locked: boolean;
  /** Send this area's whole row; resolves once the server confirmed it. */
  write: (domain: ReminderDomain, row: ReminderDomainPrefs) => Promise<void>;
}

/**
 * One area of "Vor der Abreise" (settings v3 prototype): ONE select, Aus / 2 h /
 * 24 h / 2 Tage. The channel is not here — one row above writes it to every
 * area. A lead the select has no entry for (the server keeps up to two presets
 * and one own time of 1-168 h) is shown as "Eigene: N h" and kept until the
 * person picks something else: looking at a row never rewrites it.
 */
export default function ReminderRow({
  domain,
  saved,
  locked,
  write,
}: ReminderRowProps): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const copyOf = useRowCopy("notifications");
  const w = useSettingWrite<ReminderDomainPrefs>(`notifications.${domain}`, saved, (value) =>
    write(domain, value)
  );
  const copy = copyOf(`r_${domain}`);
  const row = w.value;
  const current = leadChoiceOf(row);
  const lock = locked
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  const options = [
    { value: LEAD_OFF, label: t("settingsRows:notifications.lead.off") },
    { value: "2", label: t("settingsRows:notifications.lead.h2") },
    { value: "24", label: t("settingsRows:notifications.lead.h24") },
    { value: "48", label: t("settingsRows:notifications.lead.d2") },
    ...(current === LEAD_CUSTOM
      ? [
          {
            value: LEAD_CUSTOM,
            label: t("settingsRows:notifications.lead.own", { hours: ownLeadLabel(row.leadHours) }),
          },
        ]
      : []),
  ];

  return (
    <SettingItem
      title={copy.title}
      sub={t("settingsRows:notifications.leadSub")}
      help={copy.help}
      save={w}
      locked={lock}
      control={
        <ChoiceControl<string>
          label={copy.title}
          value={current}
          options={options}
          onChange={(next) => {
            const patch = leadPatch(next);
            if (patch) w.choose({ ...row, ...patch });
          }}
        />
      }
    />
  );
}
