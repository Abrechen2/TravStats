import { formatIsoDate } from "../../lib/dateUtils";

/**
 * The flights list's date, in one place: `YYYY-MM-DD` in the airport's own
 * zone (round-4 decision E7, ISO in tables).
 *
 * It lived inside `TimeCell`; the narrow row summary needs the same string,
 * and a second copy is how a list ends up showing two date formats on one
 * screen — the finding (D-07) that round was handed. It was "Mo 09.11.26"
 * until the CT106 audit (B11) found the four logbooks in four formats. The
 * language no longer changes it, which is the point; `lang` stays so callers
 * do not have to change shape.
 */
export const flightDateFmt = (iso: string, tz: string, _lang?: string): string =>
  formatIsoDate(iso, tz);
