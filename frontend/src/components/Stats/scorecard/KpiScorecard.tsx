import type { JSX } from "react";
import ScorecardTile, { type ScorecardTileVM } from "./ScorecardTile";

interface KpiScorecardProps {
  tiles: ScorecardTileVM[];
}

// Hero row of KPI tiles. Presentational — the page builds the view-models.
export default function KpiScorecard({ tiles }: KpiScorecardProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      {tiles.map(({ key, ...props }) => (
        <ScorecardTile key={key} {...props} />
      ))}
    </div>
  );
}
