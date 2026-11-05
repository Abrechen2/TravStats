import type { JSX } from "react";
import { Slider, Toggle } from "../../../components/map/controlPanelKit";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { SPEED_STOPS } from "./trackGeometry";
import {
  ACCURACY_OPTIONS,
  SPEED_SCALES,
  SPLIT_OPTIONS,
  TRACK_LAYERS,
  type MaxAccuracyM,
  type RouteColorMode,
  type SplitMinutes,
  type TrackMapPrefs,
} from "./trackMapPrefs";
import { makeNumber } from "./trackLegFormat";
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
  embedded = false,
  saveFailed = false,
  speedStops = SPEED_STOPS,
}: {
  prefs: TrackMapPrefs;
  onChange: (patch: Partial<TrackMapPrefs>) => void;
  /** A month, a year or a Zeitraum: the day-only layers are not available. */
  long?: boolean;
  /** Inside a floating card: no panel boxes of its own, the card is the box. */
  embedded?: boolean;
  /** The last choice did not reach storage: say so, without blocking anything. */
  saveFailed?: boolean;
  /** The ramp's stops for the chosen scale; the legend follows them. */
  speedStops?: ReadonlyArray<{ kmh: number }>;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const number = makeNumber(i18n.language);
  const coarse = useCoarsePointer();
  const rowMin = coarse ? 44 : 40;
  return (
    <aside
      aria-label={t("track:map.panel")}
      className="flex flex-col gap-3"
      style={embedded ? undefined : { flex: "1 1 240px", maxWidth: 300 }}
    >
      <fieldset className="flex flex-col gap-1" style={embedded ? undefined : panelStyle}>
        <legend
          className={embedded ? "sr-only" : "t-card-title"}
          style={embedded ? undefined : { float: "left", marginBottom: 6 }}
        >
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

      <div className="flex flex-col gap-3" style={embedded ? undefined : panelStyle}>
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
          <div className="flex flex-col gap-2">
            <div
              role="radiogroup"
              aria-label={t("track:map.route.scale.title")}
              className="flex flex-wrap gap-2"
              data-testid="track-speed-scale"
            >
              {SPEED_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  role="radio"
                  aria-checked={prefs.speedScale === scale}
                  data-scale={scale}
                  onClick={() => onChange({ speedScale: scale })}
                  style={pillStyle(prefs.speedScale === scale, rowMin)}
                >
                  {t(`track:map.route.scale.${scale}`)}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1" data-testid="track-speed-legend">
              <div aria-hidden style={{ height: 8, borderRadius: 999, background: RAMP }} />
              <div
                className="flex justify-between t-caption"
                style={{ fontFamily: "var(--ts-font-mono)", fontSize: 11 }}
              >
                {speedStops.map((s, i) => (
                  <span key={i}>
                    {i === speedStops.length - 1
                      ? t("track:map.route.kmhMax", { kmh: number(s.kmh, 1) })
                      : number(s.kmh, 1)}
                  </span>
                ))}
              </div>
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
        <label className="flex flex-col gap-1 t-caption">
          {t("track:map.route.accuracy")}
          <select
            data-testid="track-accuracy-filter"
            value={prefs.maxAccuracyM === null ? "" : String(prefs.maxAccuracyM)}
            onChange={(e) =>
              onChange({
                maxAccuracyM: (e.target.value === ""
                  ? null
                  : Number(e.target.value)) as MaxAccuracyM,
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
            {ACCURACY_OPTIONS.map((m) => (
              <option key={m ?? "all"} value={m === null ? "" : String(m)}>
                {m === null
                  ? t("track:map.route.accuracyAll")
                  : t("track:map.route.accuracyMax", { m })}
              </option>
            ))}
          </select>
          <span>{t("track:map.route.accuracyHint")}</span>
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
