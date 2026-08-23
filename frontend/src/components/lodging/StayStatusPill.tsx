import { STATUS_PILL_CLASS, statusPillStyle } from "../table/statusPillStyle";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { StayStatus } from "../../types/lodging";

/**
 * Lifecycle status pill for stays and lodging rows — the same visual idiom
 * as the flights table's status pill (FlightsTablePage), so the domain list
 * pages read as one family: green = done, blue = booked, accent = running,
 * red = cancelled.
 */
// Colours and geometry now come from the shared palette, so the three lists
// cannot drift apart again. Two things changed here: `in_progress` was the
// brand accent, which already means "the thing you are looking at" everywhere
// else and clashed with the purple cruises use for the same state; and the
// pill was flatter than the other two (py-0.5 against py-1).

export function StayStatusPill({
  status,
  testId,
}: {
  status: StayStatus;
  testId?: string;
}): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  return (
    <span
      data-testid={testId}
      className={STATUS_PILL_CLASS}
      style={statusPillStyle(status)}
    >
      {t(`lodging:stayStatus.${status}`)}
    </span>
  );
}
