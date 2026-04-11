import { SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";
import type { MapSettings } from "../../store/settingsStore";

const colorPresets = ["#2563eb", "#16a34a", "#f97316", "#7c3aed", "#e11d48"];

interface MapSectionProps {
  map: MapSettings;
  onSetMap: (partial: Partial<MapSettings>) => void;
}

export default function MapSection({ map, onSetMap }: MapSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle title={t("settings:map.title")} description={t("settings:map.description")} />
      <InlineHelp
        title={t("settings:map.help.title")}
        category="basic"
        content={
          <div className="space-y-2">
            <p>{t("settings:map.help.description")}</p>
            <div>
              <p className="font-semibold">{t("settings:map.help.styleTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:map.help.style")}</p>
            </div>
            <div>
              <p className="font-semibold">{t("settings:map.help.colorTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:map.help.color")}</p>
            </div>
          </div>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">{t("settings:map.mapStyle")}</label>
          <select
            value={map.mapStyle}
            onChange={(e) => onSetMap({ mapStyle: e.target.value as typeof map.mapStyle })}
            className="input"
          >
            <option value="osm">{t("settings:map.options.osm")}</option>
            <option value="satellite">{t("settings:map.options.satellite")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("settings:map.zoomLevel")}</label>
          <input
            type="number"
            min={1}
            max={12}
            value={map.zoomLevel}
            onChange={(e) => onSetMap({ zoomLevel: Number(e.target.value) })}
            className="input"
          />
        </div>
        <div>
          <label className="label">{t("settings:map.markerStyle")}</label>
          <select
            value={map.markerStyle}
            onChange={(e) => onSetMap({ markerStyle: e.target.value as typeof map.markerStyle })}
            className="input"
          >
            <option value="pin">{t("settings:map.options.pin")}</option>
            <option value="circle">{t("settings:map.options.circle")}</option>
            <option value="custom">{t("settings:map.options.custom")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("settings:map.routeColor")}</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={map.routeColor}
              onChange={(e) => onSetMap({ routeColor: e.target.value })}
              className="h-10 w-16 rounded"
            />
            <div className="flex gap-2">
              {colorPresets.map((color) => (
                <button
                  key={color}
                  onClick={() => onSetMap({ routeColor: color })}
                  style={{
                    backgroundColor: color,
                    border: "1px solid var(--color-border)",
                  }}
                  className="w-8 h-8 rounded-md"
                  aria-label={"Farbe " + color}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
