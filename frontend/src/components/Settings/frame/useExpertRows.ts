import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
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
 * The page's own collector: every `SectionFrame` passes up how many rows the
 * standard level hides in it, so the note at the top of the page counts
 * settings — the hidden rows of standard sections together with the settings
 * of hidden expert sections (forgejo#321 prototype).
 */
export const PageHiddenRowsContext = createContext<HiddenRowsReporter | null>(null);

/** A reporter and the sum of what was reported to it. */
export function useHiddenRowsCollector(): [number, HiddenRowsReporter] {
  const [byKey, setByKey] = useState<Record<string, number>>({});
  const report = useCallback((key: string, hidden: number) => {
    setByKey((prev) => (prev[key] === hidden ? prev : { ...prev, [key]: hidden }));
  }, []);
  const total = Object.values(byKey).reduce((sum, n) => sum + n, 0);
  return [total, report];
}

/**
 * A link or search hit named this section's expert rows (`&expert=1`): they
 * show at the standard level too, with a note, the way a named expert section
 * does — landing on a section with the named setting still hidden would send
 * the reader looking for something the page withholds (forgejo#321 review).
 */
export const RevealExpertRowsContext = createContext(false);

/**
 * Whether expert rows are drawn, and — when they are not — tells the
 * enclosing section how many were left out. `hiddenAtStandard` is the number
 * of settings the component would draw at the expert level that it skips now.
 *
 * Outside a section frame (a component test, a dialog) nothing listens, and
 * the answer is still right.
 */
export function useExpertRows(hiddenAtStandard: number): boolean {
  const revealed = useContext(RevealExpertRowsContext);
  const expert = useEffectiveSettingsLevel() === "expert" || revealed;
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
