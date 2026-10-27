import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravPlanInstanceOn } from "../../hooks/useTravPlanVisible";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { Switch } from "../ui/Field";

/**
 * TravPlan, the planning area, switched on and off for this account in the
 * rows of "Bereiche & Farben" (owner, 2026-10-27: "nichts davon muss genutzt
 * werden, alles einzeln aktivierbar so wie die Domains"). Drawn only while the
 * instance offers TravPlan — a switch for something the server does not have
 * would change nothing. Off hides the navigation entry and the server refuses
 * the plan paths; every plan stays and comes back when switched on.
 *
 * Not a domain: it has no entries of its own and no colour, so it is not in
 * `shared/domains.ts`, and its row has no colour input.
 */
export default function TravPlanModuleRow(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const instanceOn = useTravPlanInstanceOn();
  const on = useSuggestionSwitchesStore((s) => s.travPlan);
  const setOn = useSuggestionSwitchesStore((s) => s.setTravPlan);
  if (!instanceOn) return null;
  return (
    <div
      data-domain-row="travPlan"
      data-domain-on={on ? "true" : "false"}
      className="ts-setting-row flex items-center"
      style={{ gap: 12, opacity: on ? 1 : 0.5 }}
    >
      <div className="min-w-0 flex-1">
        <Switch
          id="module-travPlan"
          checked={on}
          onChange={setOn}
          label={t("settings:travPlan.label")}
          sub={t("settings:travPlan.description")}
        />
      </div>
    </div>
  );
}
