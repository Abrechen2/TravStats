import { useMemo } from "react";
import { SectionCard } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import i18n from "../../i18n/config";
import { useSettingsStore, type DisplaySettings } from "../../store/settingsStore";
import { groupTimeZones } from "../../lib/timezones";
import { SettingRows } from "../ui/SettingRow";
import { ChoiceControl, SettingItem } from "../ui/settings";
import { useSettingItem } from "../ui/settings/itemContext";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useDocumentSetting } from "./useDocumentSetting";

interface DisplaySectionProps {
  display: DisplaySettings;
}

const DATE_FORMATS = [
  { value: "DD.MM.YYYY", key: "dmy" },
  { value: "YYYY-MM-DD", key: "iso" },
  { value: "MM/DD/YYYY", key: "mdy" },
] as const;
const TIME_FORMATS = ["24h", "12h"] as const;

const setDisplay = (partial: Partial<DisplaySettings>): void =>
  useSettingsStore.getState().setDisplay(partial);

function ZoneSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (zone: string) => void;
  label: string;
}): JSX.Element {
  const { id, locked, describedBy } = useSettingItem();
  const groups = useMemo(() => groupTimeZones(value), [value]);
  // ~450 zones: a pill row cannot hold that, the select stays.
  return (
    <select
      id={id}
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      disabled={locked}
      aria-disabled={locked || undefined}
      onChange={(e) => onChange(e.target.value)}
      className="input"
      style={{ minWidth: 220 }}
    >
      {groups.map((group) => (
        <optgroup key={group.region} label={group.region}>
          {group.zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Sprache & Zeit: four immediate rows on the settings document. Each keeps the
 * user's pick when the server refuses it, says so, and puts back only itself.
 */
export default function DisplaySection({ display }: DisplaySectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  const language = useDocumentSetting<"de" | "en">("display.language", display.language, (lang) => {
    void i18n.changeLanguage(lang);
    setDisplay({ language: lang });
  });
  const timezone = useDocumentSetting<string>("display.timezone", display.timezone, (timezone) =>
    setDisplay({ timezone })
  );
  const dateFormat = useDocumentSetting<DisplaySettings["dateFormat"]>(
    "display.dateFormat",
    display.dateFormat,
    (dateFormat) => setDisplay({ dateFormat })
  );
  const timeFormat = useDocumentSetting<DisplaySettings["timeFormat"]>(
    "display.timeFormat",
    display.timeFormat,
    (timeFormat) => setDisplay({ timeFormat })
  );

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.language.name")}
          save={language}
          locked={locked}
          control={
            <ChoiceControl<"de" | "en">
              label={t("settings:rows.language.name")}
              value={language.value}
              options={[
                { value: "de", label: t("settings:display.languages.de") },
                { value: "en", label: t("settings:display.languages.en") },
              ]}
              onChange={language.choose}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.timezone.name")}
          sub={t("settings:rows.timezone.sub")}
          save={timezone}
          locked={locked}
          control={
            <ZoneSelect
              label={t("settings:rows.timezone.name")}
              value={timezone.value}
              onChange={timezone.choose}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.dateFormat.name")}
          sub={t("settings:rows.dateFormat.sub")}
          save={dateFormat}
          locked={locked}
          control={
            <ChoiceControl<DisplaySettings["dateFormat"]>
              label={t("settings:rows.dateFormat.name")}
              value={dateFormat.value}
              options={DATE_FORMATS.map(({ value, key }) => ({
                value,
                label: t(`settings:display.dateFormats.${key}`),
              }))}
              onChange={dateFormat.choose}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.timeFormat.name")}
          save={timeFormat}
          locked={locked}
          control={
            <ChoiceControl<DisplaySettings["timeFormat"]>
              label={t("settings:rows.timeFormat.name")}
              value={timeFormat.value}
              options={TIME_FORMATS.map((value) => ({
                value,
                label: t(`settings:display.timeFormats.${value}`),
              }))}
              onChange={timeFormat.choose}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
