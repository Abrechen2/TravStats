import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { SectionVisibility } from "../../hooks/useSectionVisibility";
import type { DomainKey } from "../../shared/domains";
import SectionVisibilityMenu from "./SectionVisibilityMenu";
import StatsPeriodBar from "./StatsPeriodBar";
import { statsSectionsFor } from "./statsSections";
import type { StatsPeriod } from "./useStatsPeriod";

interface Props {
  /** The tab being drawn — the menu lists that tab's blocks. */
  tab: DomainKey | "all";
  years: number[];
  period: StatsPeriod;
  visibility: SectionVisibility;
}

/**
 * The row above every statistics tab: which year, and which blocks.
 *
 * Both controls apply to whatever tab is open, so they sit together rather
 * than one above the tabs and one inside a tab. The period bar steps aside
 * when there is no year to choose — an account with nothing recorded — and the
 * menu stays, because hiding blocks is a preference, not a function of data.
 */
export default function StatsToolbar({ tab, years, period, visibility }: Props): JSX.Element {
  // The menu labels are the headings each tab draws, which live in the domain
  // namespaces as well as `stats`.
  const { t } = useTranslation(["stats", "cruise", "lodging", "places", "rail", "common"]);
  return (
    // One row on a wide screen; on a phone the period bar takes the full
    // width and the section menu its own row. Side by side, the menu kept its
    // width and squeezed twelve years into a 100px column 556px tall (CT106
    // audit B05). No horizontal padding: AppShell already draws the gutter,
    // and a second one is how the content shrank to 292px of a 390px screen.
    <div className="pt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
      {years.length > 0 && (
        <div className="min-w-0 flex-1">
          <StatsPeriodBar years={years} period={period} />
        </div>
      )}
      <div className="self-end sm:ml-auto">
        <SectionVisibilityMenu options={statsSectionsFor(tab, t)} visibility={visibility} />
      </div>
    </div>
  );
}
