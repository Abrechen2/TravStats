import type { JSX } from "react";
import { SectionCard } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useSettingsStore, type DefaultsSettings } from "../../store/settingsStore";
import { SettingRows } from "../ui/SettingRow";
import { ChoiceControl, InputControl, SettingItem } from "../ui/settings";
import { useDocumentSetting } from "./useDocumentSetting";

interface DefaultsSectionProps {
  defaults: DefaultsSettings;
}

const STATUSES = ["scheduled", "flown"] as const;
const SEAT_CLASSES = ["", "economy", "premium_economy", "business", "first"] as const;
const CATEGORIES = ["", "business", "private", "vacation"] as const;

const setDefaults = (partial: Partial<DefaultsSettings>): void =>
  useSettingsStore.getState().setDefaults(partial);

/** "Neue Flüge starten mit": four immediate rows on the settings document. */
export default function DefaultsSection({ defaults }: DefaultsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  const status = useDocumentSetting<DefaultsSettings["flightStatus"]>(
    "defaults.flightStatus",
    defaults.flightStatus,
    (flightStatus) => setDefaults({ flightStatus })
  );
  const seat = useDocumentSetting<DefaultsSettings["seatClass"]>(
    "defaults.seatClass",
    defaults.seatClass,
    (seatClass) => setDefaults({ seatClass })
  );
  const category = useDocumentSetting<DefaultsSettings["flightCategory"]>(
    "defaults.flightCategory",
    defaults.flightCategory,
    (flightCategory) => setDefaults({ flightCategory })
  );
  const airline = useDocumentSetting<string>(
    "defaults.favoriteAirline",
    defaults.favoriteAirline,
    (favoriteAirline) => setDefaults({ favoriteAirline })
  );

  const option = <T extends string>(value: T): { value: T; label: string; name?: string } =>
    value === ""
      ? {
          value,
          label: t("settings:defaults.options.noneShort"),
          name: t("settings:defaults.options.none"),
        }
      : { value, label: t(`settings:defaults.options.${value}`) };

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.flightStatus.name")}
          save={status}
          locked={locked}
          control={
            <ChoiceControl
              label={t("settings:rows.flightStatus.name")}
              value={status.value}
              options={STATUSES.map(option)}
              onChange={status.choose}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.seatClass.name")}
          save={seat}
          locked={locked}
          control={
            <ChoiceControl
              label={t("settings:rows.seatClass.name")}
              value={seat.value}
              options={SEAT_CLASSES.map(option)}
              onChange={seat.choose}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.favoriteAirline.name")}
          save={airline}
          locked={locked}
          control={<InputControl value={airline.value} onChange={airline.choose} />}
        />
        <SettingItem
          title={t("settings:rows.flightCategory.name")}
          sub={t("settings:rows.flightCategory.sub")}
          save={category}
          locked={locked}
          control={
            <ChoiceControl
              label={t("settings:rows.flightCategory.name")}
              value={category.value}
              options={CATEGORIES.map(option)}
              onChange={category.choose}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
