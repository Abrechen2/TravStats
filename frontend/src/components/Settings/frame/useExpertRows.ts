import { createContext, useContext, useEffect, useId } from "react";
import { useEffectiveSettingsLevel } from "../../../store/settingsLevelStore";

/**
 * How a section learns how many of its rows the standard level hides.
 *
 * Most sections are standard or expert as a whole and the page counts them.
 * A few hold both kinds — the flight updates switch is standard, its polling
 * window expert — and only the component knows which of its rows it is
 * leaving out, and when: the polling rows exist only while the switch is on.
 * So the component reports, and `SectionFrame` writes the "N weitere
 * Einstellungen" line under it from what was reported.
 */
export type HiddenRowsReporter = (key: string, hidden: number) => void;

export const HiddenRowsContext = createContext<HiddenRowsReporter | null>(null);

/**
 * Whether expert rows are drawn, and — when they are not — tells the
 * enclosing section how many were left out. `hiddenAtStandard` is the number
 * of settings the component would draw at the expert level that it skips now.
 *
 * Outside a section frame (a component test, a dialog) nothing listens, and
 * the answer is still right.
 */
export function useExpertRows(hiddenAtStandard: number): boolean {
  const expert = useEffectiveSettingsLevel() === "expert";
  const report = useContext(HiddenRowsContext);
  const key = useId();
  const hidden = expert ? 0 : hiddenAtStandard;
  useEffect(() => {
    if (!report) return;
    report(key, hidden);
    return () => report(key, 0);
  }, [report, key, hidden]);
  return expert;
}
