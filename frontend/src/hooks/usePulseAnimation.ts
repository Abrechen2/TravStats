import { useState, useEffect, useRef, useMemo } from "react";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../types";

const PERIOD_MS = 1800;
const RINGS: Array<{ radiusPx: number; phaseOffset: number }> = [
  { radiusPx: 12, phaseOffset: 0 },
  { radiusPx: 22, phaseOffset: 0.33 },
  { radiusPx: 36, phaseOffset: 0.66 },
];

export function usePulseAnimation(selectedFlights: Flight[]): Layer[] {
  const [pulseTime, setPulseTime] = useState(0);
  const pulseRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (pulseRafRef.current !== null) {
      cancelAnimationFrame(pulseRafRef.current);
      pulseRafRef.current = null;
    }
    setPulseTime(0);
    if (selectedFlights.length === 0) return;

    const startTime = performance.now();
    let lastUpdate = 0;
    const animate = (ts: number): void => {
      if (ts - lastUpdate > 33) {
        lastUpdate = ts;
        setPulseTime(ts - startTime);
      }
      pulseRafRef.current = requestAnimationFrame(animate);
    };
    pulseRafRef.current = requestAnimationFrame(animate);

    return () => {
      if (pulseRafRef.current !== null) cancelAnimationFrame(pulseRafRef.current);
    };
  }, [selectedFlights]);

  const pulsePoints = useMemo((): Array<[number, number]> => {
    const pts = selectedFlights.flatMap((f) => {
      const res: Array<[number, number]> = [];
      if (f.depLon != null && f.depLat != null) res.push([f.depLon, f.depLat]);
      if (f.arrLon != null && f.arrLat != null) res.push([f.arrLon, f.arrLat]);
      return res;
    });
    const seen = new Set<string>();
    return pts.filter(([lon, lat]) => {
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [selectedFlights]);

  return useMemo((): Layer[] => {
    if (pulsePoints.length === 0) return [];
    const data = pulsePoints.map((position) => ({ position }));

    return RINGS.map(({ radiusPx, phaseOffset }) => {
      const phase = (((pulseTime / PERIOD_MS + phaseOffset) % 1) + 1) % 1;
      const opacity = Math.sin(phase * Math.PI) ** 2;
      const alpha = Math.round(opacity * 210);

      return new ScatterplotLayer({
        id: `pulse-ring-${radiusPx}`,
        data,
        getPosition: (d: { position: [number, number] }) => d.position,
        getRadius: radiusPx,
        radiusUnits: "pixels",
        getFillColor: [0, 0, 0, 0] as [number, number, number, number],
        getLineColor: [245, 158, 11, alpha] as [number, number, number, number],
        stroked: true,
        filled: false,
        lineWidthMinPixels: 1.5,
        pickable: false,
      });
    });
  }, [pulsePoints, pulseTime]);
}
