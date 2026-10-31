import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";

/**
 * What a bahn.de import starts U-Bahn/tram and bus legs as — the account's
 * remembered choice, which used to be reachable only from inside an import.
 * The import dialog keeps its own „als Standard merken“; both write the same
 * stored default.
 *
 * "Gespeichert" appears only once the server confirmed a save after the
 * click: the pills are optimistic and a failed save rolls them back.
 */
export function RailImportMemoryRows(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { isEnabled } = useEnabledDomains();
  const localTransit = useSuggestionSwitchesStore((s) => s.railImportLocalTransit);
  const bus = useSuggestionSwitchesStore((s) => s.railImportBus);
  const setLocalTransit = useSuggestionSwitchesStore((s) => s.setRailImportLocalTransit);
  const setBus = useSuggestionSwitchesStore((s) => s.setRailImportBus);
  const saves = useSuggestionSwitchesStore((s) => s.railImportSaves);
  const [clickedAt, setClickedAt] = useState<number | null>(null);
  const confirmed = clickedAt !== null && saves > clickedAt;
  const key = "settings:import.railMemory";

  return (
    <div id="rail-import-memory" className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <SettingRows>
        <SettingRow
          title={t(`${key}.localTransit.title`)}
          sub={t(`${key}.localTransit.sub`)}
          control={
            <Segmented
              label={t(`${key}.localTransit.title`)}
              value={localTransit}
              onChange={(value) => {
                setClickedAt(saves);
                setLocalTransit(value);
              }}
              options={[
                { value: "skip", label: t(`${key}.localTransit.skip`) },
                { value: "rail", label: t(`${key}.localTransit.rail`) },
              ]}
            />
          }
        />
        {isEnabled("bus") && (
          <SettingRow
            title={t(`${key}.bus.title`)}
            sub={t(`${key}.bus.sub`)}
            control={
              <Segmented
                label={t(`${key}.bus.title`)}
                value={bus}
                onChange={(value) => {
                  setClickedAt(saves);
                  setBus(value);
                }}
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
        {confirmed && (
          <span role="status" className="t-caption">
            {t(`${key}.saved`)}
          </span>
        )}
        <Link to="/rail" className="t-caption" style={{ color: "var(--accent)" }}>
          {t(`${key}.openImport`)} →
        </Link>
      </div>
    </div>
  );
}
