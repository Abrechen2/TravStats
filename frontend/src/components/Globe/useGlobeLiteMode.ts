import { useCallback, useMemo, useState } from "react";
import { LITE_AUTO_ARC_THRESHOLD, LITE_AUTO_CRUISE_THRESHOLD } from "./arcUtils";
import type { LiteMode } from "./GlobeControlPanel";

export function useGlobeLiteMode(
  flightCount: number,
  cruiseCount: number
): { liteMode: LiteMode; onLiteModeChange: (next: LiteMode) => void; lite: boolean } {
  // Performance mode: drops arc tessellation to a flat 16 steps,
  // halves column disk resolution, and disables auto-highlight on
  // pickable layers. Tri-state: "auto" lets the dataset thresholds
  // decide; "on" / "off" override forever (within a session).
  const [liteMode, setLiteMode] = useState<LiteMode>(() => {
    if (typeof window === "undefined") return "auto";
    const stored = window.sessionStorage.getItem("globeLiteMode");
    return stored === "on" || stored === "off" ? stored : "auto";
  });
  const onLiteModeChange = useCallback((next: LiteMode) => {
    setLiteMode(next);
    try {
      window.sessionStorage.setItem("globeLiteMode", next);
    } catch {
      // sessionStorage may be unavailable in private mode — opt-in only
    }
  }, []);
  // Resolved boolean: lite is on if user forced it, OR auto + dataset
  // crosses one of the size thresholds. Recomputed every render — the
  // inputs are O(1) numbers so the cost is invisible.
  const lite = useMemo(() => {
    if (liteMode === "on") return true;
    if (liteMode === "off") return false;
    return flightCount >= LITE_AUTO_ARC_THRESHOLD || cruiseCount >= LITE_AUTO_CRUISE_THRESHOLD;
  }, [liteMode, flightCount, cruiseCount]);
  return { liteMode, onLiteModeChange, lite };
}
