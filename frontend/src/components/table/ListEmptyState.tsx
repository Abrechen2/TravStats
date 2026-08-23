import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * What a domain list says when it has nothing to show.
 *
 * There are TWO reasons a list is empty and they need different words. The
 * cruise and lodging lists said "Noch keine Kreuzfahrten erfasst" in both
 * cases — so searching a real library for something it does not contain made
 * the page deny the 22 cruises sitting behind the filter. Measured in the
 * browser, not deduced: type nonsense into the search box and the list claims
 * you have never been on a ship.
 *
 * With a filter active the empty state also has to offer the way out, because
 * the filter that caused it may be one the user forgot they set — that is
 * exactly what a "Filter" button with a badge makes easy to do.
 */

interface Props {
  /** True when any filter or search term is narrowing the list. */
  filtered: boolean;
  /** "Noch keine Kreuzfahrten erfasst" — the genuinely-empty headline. */
  emptyTitle: string;
  /** How to get a first entry in. Shown only in the genuinely-empty case. */
  emptyHint: string;
  onReset: () => void;
}

export default function ListEmptyState({
  filtered,
  emptyTitle,
  emptyHint,
  onReset,
}: Props): JSX.Element {
  const { t } = useTranslation(["common"]);

  return (
    <div
      className="px-4 py-12 text-center"
      style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
    >
      <p className="mb-2 text-lg" style={{ color: "var(--text-secondary)" }}>
        {filtered ? t("common:filters.noMatch") : emptyTitle}
      </p>
      {filtered ? (
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:text-[var(--text-primary)]"
        >
          {t("common:filters.reset")}
        </button>
      ) : (
        <p className="text-sm">{emptyHint}</p>
      )}
    </div>
  );
}
