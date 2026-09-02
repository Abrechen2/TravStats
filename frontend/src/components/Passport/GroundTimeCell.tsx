import { useTranslation } from "../../hooks/useTranslation";
import { formatDuration } from "../../lib/formatters";
import type { CountryGroundTime } from "../../types/passport";

/**
 * How long the traveller was on the ground in one country — spec §3.4b.
 *
 * ## Why this is a component and not two lines in the row
 *
 * The value has three states and each of them renders differently. Written
 * inline it would be a ternary that a later edit collapses into "minutes or a
 * dash", and that collapse is precisely the defect the union was shaped to
 * prevent. One home, three answers.
 *
 * ## The two lower states must not read as each other
 *
 * They ask the reader for different things, and a shared dash would throw away
 * the only actionable half:
 *
 * - `unknown` renders the WORD. A flight touched this country but no pair of
 *   clocks bounds a spell — a one-way arrival, a date-only row. The reader can
 *   fix it by recording the return leg, and the tooltip says so.
 * - `notApplicable` renders the DASH, which the table's legend already defines
 *   as "not derivable". No flight touched this country at all; a house bounds
 *   no departure, so there is nothing to add and no instruction to give.
 *
 * ## Measured is formatted, never bucketed — and a measured zero is real
 *
 * §3.4b rejected fixed classes: the owner's connection countries run 1.4 h–4.7 h
 * and the next is 25 h, so bins would sit permanently empty and hide the gap
 * that IS the finding. `formatDuration` is the app's existing duration
 * rendering, reused rather than re-invented, and it prints `0min` for a spell
 * of zero. That zero stays a zero: it means two clocks were read and agreed,
 * which is a measurement. Zero is forbidden only as a stand-in for the unknown.
 */
export default function GroundTimeCell({
  groundTime,
}: {
  groundTime: CountryGroundTime;
}): JSX.Element {
  const { t } = useTranslation(["passport"]);

  if (groundTime.state === "measured") {
    return (
      <span data-testid="ground-measured" title={t("passport:ground.measuredExplained")}>
        {formatDuration(groundTime.minutes)}
      </span>
    );
  }

  if (groundTime.state === "unknown") {
    return (
      <span
        data-testid="ground-unknown"
        style={{ color: "var(--text-muted)" }}
        title={t("passport:ground.unknownExplained")}
      >
        {t("passport:ground.unknown")}
      </span>
    );
  }

  return (
    <span
      data-testid="ground-notApplicable"
      style={{ color: "var(--text-muted)" }}
      title={t("passport:ground.notApplicableExplained")}
    >
      {t("passport:value.dash")}
    </span>
  );
}
