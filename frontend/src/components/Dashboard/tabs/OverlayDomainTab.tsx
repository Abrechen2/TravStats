import { useMemo } from "react";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useDomainVisible } from "../../../hooks/useDomainVisible";
import { useTranslation } from "../../../hooks/useTranslation";
import { useMapLabelsModeStore } from "../../../store/mapLabelsModeStore";
import MapContainer3D from "../../MapContainer3D";
import { ATTRIBUTION_CLEARANCE } from "../../map/attributionClearance";
import { buildStationLabelLayers, type StationLabelGroup } from "../../layers/stationLabelsLayer";
import { useBusOverlay } from "./busMapOverlay";
import { useFerryOverlay } from "./ferryMapOverlay";
import { useRentalOverlay } from "./rentalMapOverlay";

type Translate = (key: string) => string;
type OverlayDomain = "bus" | "ferry" | "rental";

interface DomainOverlay {
  layers: Layer[];
  legendRows: JSX.Element[];
  status: JSX.Element | null;
  loading: boolean;
  count: number;
  /** Bus and ferry only: the terminals whose names the tab draws itself. */
  stations?: StationLabelGroup;
}

const PANEL_STYLE = {
  background: "rgba(22,27,34,0.85)",
  color: "var(--text-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
} as const;

/**
 * The single-domain dashboard tab of bus, ferry and rental (forgejo#405): the
 * domain's own layer from the "Alle" map (same colour store, same legend, same
 * click cards) alone on the map, in the two views every line domain offers —
 * flat and globe. The overlay hook already gates its fetch on the user's
 * domain choice, so a switched-off domain never reaches the network from here.
 *
 * What the tab says over the map: that it is loading, that the load FAILED
 * (with a retry — never drawn as an empty domain), or that there is nothing
 * recorded yet.
 */
function OverlayDomainTab({
  domain,
  useOverlay,
}: {
  domain: OverlayDomain;
  useOverlay: (wanted: boolean, onGlobe: boolean, t: Translate) => DomainOverlay;
}): JSX.Element {
  const { mode } = useDashboardRoute();
  const { t } = useTranslation(["dashboard", "map", "common"]);
  const visible = useDomainVisible(domain);
  const onGlobe = mode === "globe";
  const overlay = useOverlay(visible, onGlobe, t);
  const labelsMode = useMapLabelsModeStore((s) => s.mode);
  const { stations } = overlay;
  const labels = useMemo(
    () =>
      stations
        ? buildStationLabelLayers([stations], { labelsMode, idPrefix: `tab-${domain}`, onGlobe })
        : [],
    [stations, labelsMode, onGlobe, domain]
  );
  const layers = useMemo(() => [...overlay.layers, ...labels], [overlay.layers, labels]);
  const empty = visible && !overlay.loading && !overlay.status && overlay.count === 0;

  return (
    <div style={{ position: "absolute", inset: 0 }} data-testid={`${domain}-tab`}>
      <MapContainer3D
        flights={[]}
        visMode={onGlobe ? "globe" : "routes"}
        extraLayers={layers}
        appearanceDomains={[domain]}
        showInternalCruises={false}
        hideInfoPill
      />

      {overlay.status}

      {overlay.legendRows.length > 0 && (
        <div
          className="flex flex-col"
          style={{
            ...PANEL_STYLE,
            position: "absolute",
            bottom: ATTRIBUTION_CLEARANCE,
            right: 12,
            zIndex: 30,
            gap: 6,
            padding: "8px 12px",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
          data-testid={`${domain}-legend`}
        >
          {overlay.legendRows}
        </div>
      )}

      {(overlay.loading || empty) && (
        <div
          role="status"
          style={{
            ...PANEL_STYLE,
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            padding: "6px 14px",
            fontSize: 13,
          }}
        >
          {overlay.loading
            ? t(`dashboard:overlayTab.${domain}.loading`)
            : t(`dashboard:overlayTab.${domain}.empty`)}
        </div>
      )}
    </div>
  );
}

export const BusTab = (): JSX.Element => (
  <OverlayDomainTab domain="bus" useOverlay={useBusOverlay} />
);
export const FerryTab = (): JSX.Element => (
  <OverlayDomainTab domain="ferry" useOverlay={useFerryOverlay} />
);
export const RentalTab = (): JSX.Element => (
  <OverlayDomainTab domain="rental" useOverlay={useRentalOverlay} />
);
