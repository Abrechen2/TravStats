import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { SPEED_STOPS } from "./trackGeometry";
import { TRACK_COLOR } from "./trackMapLayers";
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
}: {
  prefs: TrackMapPrefs;
  onChange: (patch: Partial<TrackMapPrefs>) => void;
  /** A month, a year or a Zeitraum: the day-only layers are not available. */
  long?: boolean;
  /** Folded under the map on a phone: the full width, not a 300px column. */
  fill?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
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
        {TRACK_LAYERS.map((id) => (
          <label
            key={id}
            className="flex items-center gap-3"
            style={{ minHeight: 40, opacity: long && DAY_ONLY.has(id) ? 0.55 : 1 }}
          >
            <input
              type="checkbox"
              disabled={long && DAY_ONLY.has(id)}
              checked={prefs.layers[id] && !(long && DAY_ONLY.has(id))}
              onChange={() => onChange({ layers: { ...prefs.layers, [id]: !prefs.layers[id] } })}
              style={{ width: 18, height: 18, accentColor: TRACK_COLOR }}
            />
            <span className="flex flex-col">
              <span style={{ fontSize: 15 }}>{t(`track:map.layers.${id}`)}</span>
              <span className="t-caption">
                {t(
                  long && DAY_ONLY.has(id)
                    ? "track:map.layers.dayOnly"
                    : `track:map.layers.${id}Hint`
                )}
              </span>
            </span>
          </label>
        ))}
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
              style={pillStyle(prefs.color === mode)}
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
        <label className="flex flex-col gap-1 t-caption">
          {t("track:map.route.opacity")}
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(prefs.opacity * 100)}
            onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
            style={{ accentColor: TRACK_COLOR }}
          />
        </label>
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
              minHeight: 40,
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
      </div>
    </aside>
  );
}
