import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravPlanInstanceOn } from "../../hooks/useTravPlanVisible";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, SwitchControl } from "../ui/settings";

/**
 * "Planen": TravPlan, switched on and off for this account. Drawn only while the
 * instance offers TravPlan — a switch for something the server does not have
 * would change nothing. Off hides the entry and the server refuses the plan
 * paths; every plan stays and comes back when switched on. Not a domain: it has
 * no entries of its own and no colour.
 */
export default function PlanningSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const instanceOn = useTravPlanInstanceOn();
  const on = useSuggestionSwitchesStore((s) => s.travPlan);
  const setOn = useSuggestionSwitchesStore((s) => s.setTravPlan);
  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.travPlan.name")}
          sub={t("settings:rows.travPlan.sub")}
          help={t("settings:rows.travPlan.help")}
          locked={
            instanceOn
              ? undefined
              : { why: "adminForbade", reason: t("settings:rows.travPlan.offOnServer") }
          }
          control={
            <SwitchControl
              checked={on && instanceOn}
              onChange={setOn}
              label={t("settings:rows.travPlan.name")}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
