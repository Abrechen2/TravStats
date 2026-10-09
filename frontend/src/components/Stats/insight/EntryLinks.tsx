import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";

export interface EntryLink {
  key: string;
  href: string;
  label: string;
  /** One line of what this entry contributes — "3 Nächte", "2019 · 2021". */
  detail?: string | null;
}

/**
 * The entries behind a record or a ranked figure, each a link to the entry
 * itself. Used where the figure is not a sum the evidence panel can split — a
 * longest gap IS its two stays, so they are named on the spot instead of
 * behind a panel that would list one row.
 */
export default function EntryLinks({
  entries,
  open = false,
  testId,
}: {
  entries: readonly EntryLink[];
  open?: boolean;
  testId?: string;
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  if (entries.length === 0) return null;
  return (
    <details className="mt-2 text-xs" open={open} data-testid={testId}>
      <summary className="cursor-pointer select-none text-(--text-muted) underline decoration-dotted underline-offset-2">
        {t("stats:insight.entries", { count: entries.length })}
      </summary>
      <ul className="mt-2 space-y-1">
        {entries.map((e) => (
          <li key={e.key} className="flex flex-wrap items-baseline gap-x-2">
            <Link to={e.href} className="underline underline-offset-2 hover:opacity-80">
              {e.label}
            </Link>
            {e.detail && <span className="text-(--text-muted)">{e.detail}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
