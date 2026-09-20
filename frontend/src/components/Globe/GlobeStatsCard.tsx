// The globe's "Sichtbar" panel — what the current slider window contains.
//
// Lifted out of `GlobeView.tsx` when its z-index had to change: the component
// is on the file-size ratchet and a listed file may shrink, never grow. The
// cut is the honest one anyway — this is a readout of numbers someone else
// computed, with no knowledge of layers, cameras or projections in it.

import type { JSX } from "react";
import type { useTranslation } from "../../hooks/useTranslation";

export interface GlobeLiveStats {
  flights: number;
  routes: number;
  flightKm: number;
  cruises: number;
  ports: number;
  topAirport: { iata?: string; name: string; size: number } | null;
}

interface GlobeStatsCardProps {
  stats: GlobeLiveStats;
  t: ReturnType<typeof useTranslation>["t"];
}

export function GlobeStatsCard({ stats, t }: GlobeStatsCardProps): JSX.Element | null {
  if (stats.flights === 0 && stats.cruises === 0) return null;

  return (
    /* Top-right, driven by the same slider-filtered data as the globe layers,
       so the numbers tick in real time as the reader scrubs. Top-LEFT is
       owned by the dashboard's Aktivität sidebar, and the `top-16` offset
       clears DashboardLayout's "+ hinzufügen" button, which is in this corner
       whatever the map mode.

       z-30, not z-10: `GlobeLabelsOverlay` draws the map's own label pills at
       z-20 across the whole canvas, and at 390×844 they drew straight over
       this card (browser verification, beta.12). A label is scenery; a stats
       panel is chrome, and chrome sits above it.

       z-30 is also the FLOOR of the globe's chrome ladder, which is written
       out here because it is the only rung that is always on screen: labels
       z-20 (scenery), this card z-30, the first-run coachmark z-40
       (`GlobeView`), the pinned popup z-50 (`GlobePinnedOverlay`). The two
       above answer one moment and then go away; this one cannot cover them.
       All three were z-30 until 2026-09-20 and the order was whatever the JSX
       mount order happened to be — so moving this element a few lines up, or
       extracting it into a component as this branch did, would have put an
       always-on panel over the popup the reader clicked. */
    <div className="absolute top-16 right-4 z-30" style={{ pointerEvents: "auto" }}>
      <div
        className="rounded-xl p-3 text-xs"
        style={{
          background: "rgba(13, 17, 23, 0.85)",
          backdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "rgba(241,245,249,0.95)",
          fontFamily: "'Inter', sans-serif",
          minWidth: 168,
          boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
        }}
      >
        <div
          className="mb-1.5 text-[10px] font-semibold uppercase"
          style={{ letterSpacing: "0.08em", color: "rgba(241,245,249,0.45)" }}
        >
          {t("map:globe.stats.title")}
        </div>
        <div className="space-y-0.5 text-[11px]">
          <Row
            show={stats.flights > 0}
            label={t("map:globe.stats.flights")}
            value={stats.flights}
          />
          <Row show={stats.routes > 0} label={t("map:globe.stats.routes")} value={stats.routes} />
          <Row
            show={stats.flightKm > 0}
            label={t("map:globe.stats.flightKm")}
            value={`${stats.flightKm.toLocaleString()} km`}
          />
          <Row
            show={stats.cruises > 0}
            label={t("map:globe.stats.cruises")}
            value={stats.cruises}
          />
          <Row show={stats.ports > 0} label={t("map:globe.stats.ports")} value={stats.ports} />
          {stats.topAirport && (
            <div
              className="mt-1.5 border-t pt-1 text-[10px] opacity-80"
              style={{ borderColor: "rgba(255,255,255,0.12)" }}
            >
              <span className="opacity-75">{t("map:globe.stats.top")}:</span>{" "}
              <span className="font-medium">{stats.topAirport.iata ?? stats.topAirport.name}</span>
              <span className="ml-1 opacity-60">×{stats.topAirport.size}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  show,
  label,
  value,
}: {
  show: boolean;
  label: string;
  value: string | number;
}): JSX.Element | null {
  if (!show) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-75">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
