import type { JSX } from "react";
import ScorecardTile, { type ScorecardTileVM } from "./ScorecardTile";
import CountingHelp from "../counting/CountingHelp";
import type { CountingEntry } from "../counting/countingEntry";

interface KpiScorecardProps {
  tiles: ScorecardTileVM[];
}

// Hero row of KPI tiles. Presentational — the page builds the view-models,
// including where each tile's counting answers live (`help`); the row lists
// them once, under the tiles.
export default function KpiScorecard({ tiles }: KpiScorecardProps): JSX.Element {
  const help: CountingEntry[] = tiles.flatMap(({ label, help: source }) =>
    source ? [{ term: label, ...source }] : []
  );
  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map(({ key, ...props }) => (
          <ScorecardTile key={key} {...props} />
        ))}
      </div>
      <CountingHelp testId="kpi-scorecard-help" entries={help} />
    </div>
  );
}
