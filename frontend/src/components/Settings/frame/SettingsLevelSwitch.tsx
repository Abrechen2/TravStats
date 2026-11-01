import type { JSX } from "react";
import { Segmented } from "../../ui/Segmented";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  useEffectiveSettingsLevel,
  useSettingsLevelKnown,
  useSettingsLevelStore,
  type SettingsLevel,
} from "../../../store/settingsLevelStore";

/**
 * Standard | Experte, in the sidebar under the search (design §0.2). One
 * preference per account (forgejo#321), stored with the account's settings,
 * so a phone and a laptop show the same amount. Under it, one line says what
 * the other level adds: "Experte zeigt N weitere Einstellungen" at Standard,
 * "Alles sichtbar · Feinarbeit ist markiert" at Expert.
 */
export function SettingsLevelSwitch({ moreCount }: { moreCount: number }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const level = useEffectiveSettingsLevel();
  const known = useSettingsLevelKnown();
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  // One sentence says what "Experte" adds (forgejo#318), so the choice is
  // not a guess; small, under the pills, at the page's top right.
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <Segmented<SettingsLevel>
        label={t("settings:level.label")}
        value={level}
        disabled={!known}
        onChange={setLevel}
        options={[
          { value: "standard", label: t("settings:level.standard") },
          { value: "expert", label: t("settings:level.expert") },
        ]}
      />
      <p
        className="t-caption"
        data-testid="settings-level-more"
        style={{ color: "var(--ts-muted)" }}
      >
        {level === "expert"
          ? t("settings:level.allVisible")
          : t("settings:level.moreInExpert", { count: moreCount })}
      </p>
    </div>
  );
}
