import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import {
  useSuggestionSwitchesStore,
  type RailImportBus,
  type RailImportLocalTransit,
} from "../../store/suggestionSwitchesStore";
import { ChoiceControl, SettingItem, useSettingWrite } from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { saveSwitch } from "../../store/confirmedSettings";
import { useRowCopy } from "./rowCopy";

/**
 * "Beim Import von bahn.de" (design §4 A11, Experte): what a bahn.de import
 * starts U-Bahn/tram and bus legs as — the account's remembered choice, which
 * used to be reachable only from inside an import. The import dialog keeps its
 * own „als Standard merken"; both write the same stored default.
 *
 * Each choice writes at once, keeps the pick when the server refuses, and the
 * stores (and so the import dialog) take the value only once it was confirmed.
 */
export function RailImportMemoryRows(): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const row = useRowCopy("data");
  const { isEnabled } = useEnabledDomains();
  const localTransit = useSuggestionSwitchesStore((s) => s.railImportLocalTransit);
  const bus = useSuggestionSwitchesStore((s) => s.railImportBus);
  const key = "settings:import.railMemory";

  const local = useSettingWrite<RailImportLocalTransit>(
    "data.railImport.localTransit",
    localTransit,
    (v, o) => saveSwitch("railImportLocalTransit", v, o)
  );
  const buses = useSettingWrite<RailImportBus>("data.railImport.bus", bus, (v, o) =>
    saveSwitch("railImportBus", v, o)
  );
  const ubahn = row("ubahn");
  const busleg = row("busleg");

  return (
    <div id="rail-import-memory" className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <SettingRows>
        <SettingItem
          title={ubahn.title}
          sub={ubahn.sub}
          expert
          save={local}
          control={
            <ChoiceControl<RailImportLocalTransit>
              label={ubahn.title}
              value={local.value}
              onChange={local.choose}
              options={[
                { value: "skip", label: t(`${key}.localTransit.skip`) },
                { value: "rail", label: t(`${key}.localTransit.rail`) },
              ]}
            />
          }
        />
        {isEnabled("bus") && (
          <SettingItem
            title={busleg.title}
            sub={busleg.sub}
            expert
            save={buses}
            control={
              <ChoiceControl<RailImportBus>
                label={busleg.title}
                value={buses.value}
                onChange={buses.choose}
                options={[
                  { value: "skip", label: t(`${key}.bus.skip`) },
                  { value: "bus", label: t(`${key}.bus.bus`) },
                ]}
              />
            }
          />
        )}
      </SettingRows>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <Link to="/rail" className="t-caption" style={{ color: "var(--accent)" }}>
          {t(`${key}.openImport`)} →
        </Link>
      </div>
    </div>
  );
}
