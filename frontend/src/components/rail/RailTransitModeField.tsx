import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { RAIL_TRANSIT_MODES, type RailTransitMode } from "../../shared/railCounting";
import { INPUT_CLASS } from "./railFormFields";

/**
 * Train, U-Bahn or tram (2026-10-23). A U-Bahn or tram ride stays a journey in
 * the logbook but counts in no rail figure — said under the field, so changing
 * it is never a silent change to the statistics.
 */
export function RailTransitModeField({
  value,
  onChange,
}: {
  value: RailTransitMode;
  onChange: (value: RailTransitMode) => void;
}): JSX.Element {
  const { t } = useTranslation(["rail"]);
  return (
    <div className="mt-3 sm:max-w-xs">
      <label className="block text-sm" htmlFor="rail-transitMode">
        {t("rail:transitMode.label")}
      </label>
      <select
        id="rail-transitMode"
        className={`mt-1 ${INPUT_CLASS}`}
        value={value}
        onChange={(e): void => onChange(e.target.value as RailTransitMode)}
        aria-describedby={value === "rail" ? undefined : "rail-transitMode-hint"}
      >
        {RAIL_TRANSIT_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {t(`rail:transitMode.${mode}`)}
          </option>
        ))}
      </select>
      {value !== "rail" && (
        <p id="rail-transitMode-hint" className="t-caption mt-1">
          {t("rail:transitMode.notCounted")}
        </p>
      )}
    </div>
  );
}
