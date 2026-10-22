import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useRecordedFlightPathsStore } from "../../store/recordedFlightPathsStore";
import { MUTED_TEXT, Toggle } from "./controlPanelKit";

/**
 * „Aufgezeichnete Flugwege zeigen (wo vorhanden)" — the flight section's
 * switch for drawing recorded flights beside the route arcs (forgejo#312).
 * Reads and writes `recordedFlightPathsStore` directly, as the overlay
 * sections read theirs: the fetch it controls lives outside the map panel.
 * Behind the `flightTrackUpload` beta key, like the recordings themselves.
 */
export function RecordedFlightPathsToggle(): JSX.Element | null {
  const { t } = useTranslation();
  const { isFeatureVisible } = useBetaFeatures();
  const show = useRecordedFlightPathsStore((s) => s.show);
  const setShow = useRecordedFlightPathsStore((s) => s.setShow);
  if (!isFeatureVisible("flightTrackUpload")) return null;
  return (
    <div className="-mx-1 mt-1.5" data-testid="recorded-flight-paths-toggle">
      <Toggle
        checked={show}
        onChange={setShow}
        icon="〰️"
        label={t("map:globe.panel.recordedFlightPaths")}
      />
      <div className="px-2 text-[10px] leading-snug" style={{ color: MUTED_TEXT }}>
        {t("map:globe.panel.recordedFlightPathsHint")}
      </div>
    </div>
  );
}
