import { useMemo } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { changeLanguage } from "../../i18n/config";
import type { DisplaySettings } from "../../store/settingsStore";
import { groupTimeZones } from "../../lib/timezones";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import DemoLockedNotice from "./DemoLockedNotice";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";

interface DisplaySectionProps {
  display: DisplaySettings;
  onSetDisplay: (partial: Partial<DisplaySettings>) => void;
}

// i18next splits keys on ".", so the stored values cannot be keys themselves.
const DATE_FORMATS = [
  { value: "DD.MM.YYYY", key: "dmy" },
  { value: "YYYY-MM-DD", key: "iso" },
  { value: "MM/DD/YYYY", key: "mdy" },
] as const;
const TIME_FORMATS = ["24h", "12h"] as const;

export default function DisplaySection({
  display,
  onSetDisplay,
}: DisplaySectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  // Recomputed only when the stored zone changes: the IANA list is ~450 entries
  // and the grouping is pure, so rebuilding it on every keystroke elsewhere in
  // the settings form would be wasted work.
  const timezoneGroups = useMemo(() => groupTimeZones(display.timezone), [display.timezone]);
  // The server refuses a settings PUT from the shared demo with a 403, and
  // until the beta audit of 2026-09-19 nothing here said so: the change was
  // applied locally, the toast said "Speichern fehlgeschlagen", and the new
  // value survived a reload. The store rolls the value back now; these
  // controls say beforehand that there is nothing to roll back FROM.
  const isDemo = useIsDemoAccount();

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:display.title")}
        description={t("settings:display.description")}
      />
      {isDemo && <DemoLockedNotice />}
      <SettingRows>
        <SettingRow
          title={t("settings:display.language")}
          sub={t("settings:display.languageSub")}
          control={
            <Segmented
              label={t("settings:display.language")}
              value={display.language}
              options={[
                { value: "de", label: t("settings:display.languages.de") },
                { value: "en", label: t("settings:display.languages.en") },
              ]}
              onChange={(lang) => void changeLanguage(lang)}
              disabled={isDemo}
            />
          }
        />
        {/* ~450 zones: a pill row cannot hold that, the select stays. */}
        <SettingRow
          title={t("settings:display.timezone")}
          sub={t("settings:display.timezoneSub")}
          htmlFor="display-timezone"
          control={
            <select
              id="display-timezone"
              value={display.timezone}
              onChange={(e) => onSetDisplay({ timezone: e.target.value })}
              disabled={isDemo}
              className="input"
              style={{ minWidth: 220 }}
            >
              {timezoneGroups.map((group) => (
                <optgroup key={group.region} label={group.region}>
                  {group.zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t("settings:display.dateFormat")}
          sub={t("settings:display.dateFormatSub")}
          control={
            <Segmented
              label={t("settings:display.dateFormat")}
              value={display.dateFormat}
              options={DATE_FORMATS.map(({ value, key }) => ({
                value,
                label: t(`settings:display.dateFormats.${key}`),
              }))}
              onChange={(dateFormat) => onSetDisplay({ dateFormat })}
              disabled={isDemo}
            />
          }
        />
        <SettingRow
          title={t("settings:display.timeFormat")}
          sub={t("settings:display.timeFormatSub")}
          control={
            <Segmented
              label={t("settings:display.timeFormat")}
              value={display.timeFormat}
              options={TIME_FORMATS.map((value) => ({
                value,
                label: t(`settings:display.timeFormats.${value}`),
              }))}
              onChange={(timeFormat) => onSetDisplay({ timeFormat })}
              disabled={isDemo}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
