import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravPlanInstanceOn } from "../../hooks/useTravPlanVisible";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import {
  JumpControl,
  SettingItem,
  SwitchControl,
  useGuardedNavigate,
  useSettingWrite,
} from "../ui/settings";
import { saveSwitch } from "../../store/confirmedSettings";

/** Plans are shared through the connection to each friend (Freunde & Teilen). */
const FRIENDS_PATH = "/settings/freunde";

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
  const navigate = useGuardedNavigate();
  const on = useSuggestionSwitchesStore((s) => s.travPlan);
  const write = useSettingWrite<boolean>("planning.travPlan", on, (next) =>
    saveSwitch("travPlan", next)
  );
  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.travPlan.name")}
          sub={t("settings:rows.travPlan.sub")}
          help={t("settings:rows.travPlan.help")}
          save={write}
          locked={
            instanceOn
              ? undefined
              : { why: "adminForbade", reason: t("settings:rows.travPlan.offOnServer") }
          }
          control={
            <SwitchControl
              checked={write.value && instanceOn}
              onChange={write.choose}
              label={t("settings:rows.travPlan.name")}
            />
          }
        />
        {write.value && instanceOn ? (
          <SettingItem
            title={t("settings:rows.planShare.name")}
            sub={t("settings:rows.planShare.sub")}
            control={
              <JumpControl
                label={t("settings:rows.planShare.jump")}
                onJump={() => navigate(FRIENDS_PATH)}
              />
            }
          />
        ) : null}
      </SettingRows>
    </SectionCard>
  );
}
