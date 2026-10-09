import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";

/** The five answers every new figure owes its reader (statistics expansion brief). */
export interface InsightHelpText {
  /** What one unit of the figure is: a night, a visit, a kilometre. */
  unit: string;
  /** Which clock and calendar decide when it happened. */
  time: string;
  /** Which records it is read from. */
  source: string;
  /** How much of the data could answer — said in numbers where there are any. */
  coverage: string;
  /** What is deliberately left out, and why. */
  exclusions: string;
}

/**
 * "Wie gezählt?" under a figure.
 *
 * A native `<details>`: it opens with Enter or Space from the keyboard and with
 * a tap on a tablet, announces its state to a screen reader, and needs no
 * hover — a tooltip would hide exactly this text from the iPad the web build
 * is drawn for.
 */
export default function InsightHelp({
  help,
  testId,
}: {
  help: InsightHelpText;
  testId?: string;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const rows: Array<[string, string]> = [
    [t("stats:insight.help.unit"), help.unit],
    [t("stats:insight.help.time"), help.time],
    [t("stats:insight.help.source"), help.source],
    [t("stats:insight.help.coverage"), help.coverage],
    [t("stats:insight.help.exclusions"), help.exclusions],
  ];
  return (
    <details className="mt-3 text-xs" data-testid={testId}>
      <summary className="cursor-pointer select-none text-(--text-muted) underline decoration-dotted underline-offset-2">
        {t("stats:insight.help.summary")}
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="font-medium text-(--text-muted)">{label}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
