import { useCallback, useMemo } from "react";
import { useLightBasemap } from "../../../components/map/useBasemapStyle";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type { LegMode } from "../../../lib/api/travtrackLegs";
import {
  modeColor,
  modeColorKeyOf,
  modeColorTable,
  type ModeColorKey,
  type ModeColorOverrides,
} from "../../../lib/trackModeColor";
import { legLines } from "./trackLegs";
import type { DayResult } from "./trackRange";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/**
 * Colour by transport mode for the track map: the colour table, one stretch per leg of
 * the loaded days (a long span has no legs), the modes on screen for the legend, and the
 * colour of a single leg's mode for its card.
 */
export function useTrackModeColors(overrides: ModeColorOverrides, loaded: readonly Loaded[]) {
  const { colors: domainColors } = useDomainColors();
  const lightBasemap = useLightBasemap();
  const modeColors = useMemo(
    () => modeColorTable(overrides, domainColors, lightBasemap),
    [overrides, domainColors, lightBasemap]
  );
  const modePaths = useMemo(
    () =>
      loaded.flatMap((r) =>
        (r.day.legs ?? []).flatMap((leg) =>
          legLines(r.day, leg).map((path) => ({ path, mode: modeColorKeyOf(leg.mode) }))
        )
      ),
    [loaded]
  );
  const modesShown = useMemo(
    () => [...new Set(modePaths.map((p) => p.mode))] as ModeColorKey[],
    [modePaths]
  );
  const colorOfMode = useCallback(
    (mode: LegMode) => modeColor(modeColorKeyOf(mode), overrides, domainColors, lightBasemap),
    [overrides, domainColors, lightBasemap]
  );
  return { modeColors, modePaths, modesShown, colorOfMode };
}
