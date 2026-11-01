import type { JSX } from "react";
import { SectionCard } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useSettingsStore, type CruiseSettings } from "../../store/settingsStore";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { SettingRows } from "../ui/SettingRow";
import { ChoiceControl, InputControl, SettingItem, SwitchControl } from "../ui/settings";
import { useDocumentSetting } from "./useDocumentSetting";

const NO_CABIN = "none";
type Cabin = NonNullable<CruiseSettings["defaultCabinType"]>;

const CABIN_TYPES: readonly Cabin[] = ["inside", "oceanview", "balcony", "suite"];

interface CruisePreferencesSectionProps {
  cruise: CruiseSettings;
}

const setCruise = (partial: Partial<CruiseSettings>): void =>
  useSettingsStore.getState().setCruise(partial);

/**
 * "Neue Kreuzfahrten starten mit" and "Zählen". "Routen auf der Karte" is gone
 * from here (design 2026-11-01): the map's own panel owns the cruise layer.
 */
export default function CruisePreferencesSection({
  cruise,
}: CruisePreferencesSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "cruise"]);
  const isDemo = useIsDemoAccount();
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const seaDaysCounted = useSuggestionSwitchesStore((s) => s.cruiseSeaDaysCounted);
  const setSeaDaysCounted = useSuggestionSwitchesStore((s) => s.setCruiseSeaDaysCounted);

  const line = useDocumentSetting<string>("cruise.defaultLine", cruise.defaultLine, (defaultLine) =>
    setCruise({ defaultLine })
  );
  const cabin = useDocumentSetting<string>(
    "cruise.defaultCabinType",
    cruise.defaultCabinType ?? NO_CABIN,
    (value) => setCruise({ defaultCabinType: value === NO_CABIN ? null : (value as Cabin) })
  );

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.cruiseLine.name")}
          save={line}
          locked={locked}
          control={<InputControl value={line.value} onChange={line.choose} />}
        />
        <SettingItem
          title={t("settings:rows.cruiseCabin.name")}
          save={cabin}
          locked={locked}
          control={
            <ChoiceControl<string>
              label={t("settings:rows.cruiseCabin.name")}
              value={cabin.value}
              options={[
                {
                  value: NO_CABIN,
                  label: t("settings:defaults.options.noneShort"),
                  name: t("settings:cruisePreferences.defaultCabinNone"),
                },
                ...CABIN_TYPES.map((c) => ({
                  value: c as string,
                  label: t(`cruise:cabinType.${c}`),
                })),
              ]}
              onChange={cabin.choose}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.seaDays.name")}
          help={t("settings:rows.seaDays.help")}
          locked={locked}
          control={
            <SwitchControl
              checked={seaDaysCounted}
              onChange={setSeaDaysCounted}
              label={t("settings:rows.seaDays.name")}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
