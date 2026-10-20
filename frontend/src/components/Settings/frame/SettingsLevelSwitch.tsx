import type { JSX } from "react";
import { Segmented } from "../../ui/Segmented";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  useEffectiveSettingsLevel,
  useSettingsLevelStore,
  type SettingsLevel,
} from "../../../store/settingsLevelStore";

/**
 * Standard | Experte, at the top of every settings and admin page. One
 * preference per account (forgejo#321), stored with the account's settings,
 * so a phone and a laptop show the same amount.
 */
export function SettingsLevelSwitch(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const level = useEffectiveSettingsLevel();
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  return (
    <Segmented<SettingsLevel>
      label={t("settings:level.label")}
      value={level}
      onChange={setLevel}
      options={[
        { value: "standard", label: t("settings:level.standard") },
        { value: "expert", label: t("settings:level.expert") },
      ]}
    />
  );
}
