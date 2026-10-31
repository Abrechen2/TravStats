import type { JSX } from "react";
import { Slider, Toggle } from "../../../components/map/controlPanelKit";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { SPEED_STOPS } from "./trackGeometry";
import {
  SPLIT_OPTIONS,
  TRACK_LAYERS,
  type RouteColorMode,
  type SplitMinutes,
  type TrackMapPrefs,
} from "./trackMapPrefs";
import { panelStyle, pillStyle } from "./trackMapStyle";

const rgb = (c: readonly number[]) => `rgb(${c.join(", ")})`;
const RAMP = `linear-gradient(90deg, ${SPEED_STOPS.map((s) => rgb(s.rgb)).join(", ")})`;

/**
 * „Ebenen" and „Strecken" (TravTrack plan T5.2): which layers the map draws,
 * the route's colour (by speed or one colour), its opacity, and a pause after
 * which a stretch is cut further. The note under the select says what the
 * select cannot do: zones, deletions and flight mode always cut.
 */
/** Layers drawn from the days' labels: a range read carries none. */
const DAY_ONLY: ReadonlySet<string> = new Set(["visits", "entries"]);

export default function TrackLayersPanel({
  prefs,
  onChange,
  long = false,
  fill = false,
  saveFailed = false,
}: {
  prefs: TrackMapPrefs;
  onChange: (patch: Partial<TrackMapPrefs>) => void;
  /** A month, a year or a Zeitraum: the day-only layers are not available. */
  long?: boolean;
  /** Folded under the map on a phone: the full width, not a 300px column. */
  fill?: boolean;
  /** The last choice did not reach storage: say so, without blocking anything. */
  saveFailed?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const rowMin = coarse ? 44 : 40;
  return (
    <aside
      aria-label={t("track:map.panel")}
      className="flex flex-col gap-3"
      style={fill ? undefined : { flex: "1 1 240px", maxWidth: 300 }}
    >
      <fieldset className="flex flex-col gap-1" style={panelStyle}>
        <legend className="t-card-title" style={{ float: "left", marginBottom: 6 }}>
          {t("track:map.layers.title")}
        </legend>
        {TRACK_LAYERS.map((id) => {
          const dayOnlyOff = long && DAY_ONLY.has(id);
          return (
            <Toggle
              key={id}
              tone="surface"
              disabled={dayOnlyOff}
              checked={prefs.layers[id] && !dayOnlyOff}
              onChange={() => onChange({ layers: { ...prefs.layers, [id]: !prefs.layers[id] } })}
              label={t(`track:map.layers.${id}`)}
              sub={t(dayOnlyOff ? "track:map.layers.dayOnly" : `track:map.layers.${id}Hint`)}
            />
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-3" style={panelStyle}>
        <h2 className="t-card-title">{t("track:map.route.title")}</h2>
        <div role="radiogroup" aria-label={t("track:map.route.color")} className="flex gap-2">
          {(["speed", "plain"] as RouteColorMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={prefs.color === mode}
              onClick={() => onChange({ color: mode })}
              style={pillStyle(prefs.color === mode, rowMin)}
            >
              {t(`track:map.route.${mode}`)}
            </button>
          ))}
        </div>
        {prefs.color === "speed" && (
          <div className="flex flex-col gap-1" data-testid="track-speed-legend">
            <div aria-hidden style={{ height: 8, borderRadius: 999, background: RAMP }} />
            <div
              className="flex justify-between t-caption"
              style={{ fontFamily: "var(--ts-font-mono)", fontSize: 11 }}
            >
              {SPEED_STOPS.map((s, i) => (
                <span key={s.kmh}>
                  {i === SPEED_STOPS.length - 1
                    ? t("track:map.route.kmhMax", { kmh: s.kmh })
                    : s.kmh}
                </span>
              ))}
            </div>
          </div>
        )}
        <Slider
          tone="surface"
          label={t("track:map.route.opacity")}
          min={20}
          max={100}
          step={1}
          value={Math.round(prefs.opacity * 100)}
          onChange={(v) => onChange({ opacity: v / 100 })}
          format={(v) => `${v} %`}
        />
        <label className="flex flex-col gap-1 t-caption">
          {t("track:map.route.split")}
          <select
            value={prefs.splitMinutes === null ? "" : String(prefs.splitMinutes)}
            onChange={(e) =>
              onChange({
                splitMinutes: (e.target.value === ""
                  ? null
                  : Number(e.target.value)) as SplitMinutes,
              })
            }
            style={{
              minHeight: rowMin,
              borderRadius: 8,
              padding: "0 8px",
              background: "var(--ts-surface2)",
              color: "var(--ts-text)",
              border: "1px solid var(--ts-border-input)",
            }}
          >
            {SPLIT_OPTIONS.map((m) => (
              <option key={m ?? "none"} value={m === null ? "" : String(m)}>
                {m === null
                  ? t("track:map.route.splitNone")
                  : m < 60
                    ? t("track:map.route.splitMinutes", { count: m })
                    : t("track:map.route.splitHours", { count: m / 60 })}
              </option>
            ))}
          </select>
        </label>
        <span className="t-caption">{t("track:map.route.alwaysCut")}</span>
        {saveFailed && (
          <span role="status" className="t-caption" data-testid="track-prefs-not-remembered">
            {t("track:map.route.notRemembered")}
          </span>
        )}
      </div>
    </aside>
  );
}
