import { useState } from "react";
import type { JSX, ReactNode } from "react";

import { useTranslation } from "../../../hooks/useTranslation";

export interface RankedRow {
  /** Stable key AND the label shown, unless `render` overrides the label. */
  key: string;
  label: ReactNode;
  /** Drives the bar width, relative to the largest row in the list. */
  weight: number;
  /** Right-hand figure, already formatted — this component never formats. */
  value: string;
  /** Optional second line under the label (sample size, total, …). */
  hint?: string | null;
}

interface Props {
  title: string;
  rows: RankedRow[];
  /** Bar colour; defaults to the lodging domain token. */
  accent?: string;
  /** Rendered instead of the list when there is nothing to show. */
  emptyLabel: string;
  /** Cap the rows shown. The caller says how many were dropped via `moreLabel`. */
  limit?: number;
  /**
   * e.g. "+ 12 weitere" — shown only when `limit` actually cut something.
   *
   * It is a BUTTON that expands the list in place, not a caption. It used to be
   * plain text, which promised rows and led nowhere (Alex, 2026-08-29). The
   * rows are already loaded, so a modal would be ceremony around data that is
   * sitting in the component.
   */
  moreLabel?: (hidden: number) => string;
}

/**
 * One ranked list with a proportional bar. Shared by the money and quality
 * blocks so "top chains by price" and "top chains by rating" cannot drift
 * apart visually.
 *
 * The bar is scaled against the largest row rather than against an absolute
 * maximum: these lists compare rows to each other ("which chain costs most"),
 * never to a fixed ceiling, and a bar scaled to an absolute would be a stub in
 * every list where the user's real range is narrow.
 */
export default function RankedBarList({
  title,
  rows,
  accent = "var(--domain-lodging, #d4778f)",
  emptyLabel,
  limit,
  moreLabel,
}: Props): JSX.Element {
  const { t } = useTranslation(["common"]);
  const [expanded, setExpanded] = useState(false);
  const shown = limit !== undefined && !expanded ? rows.slice(0, limit) : rows;
  const hidden = rows.length - shown.length;
  const max = shown.reduce((m, r) => Math.max(m, r.weight), 0);

  return (
    <div
      className="rounded-lg border p-5"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--color-border)",
        color: "var(--text-primary)",
      }}
    >
      <h3 className="mb-3 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>

      {shown.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((row) => (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm">{row.label}</span>
                <span
                  className="shrink-0 text-sm font-semibold"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {row.value}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  // max can be 0 when every row weighs nothing (e.g. a rating
                  // list where all averages are 0). Guard, or the width is NaN.
                  style={{
                    width: max > 0 ? `${Math.max(2, (row.weight / max) * 100)}%` : "2%",
                    background: accent,
                  }}
                />
              </div>
              {row.hint && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {row.hint}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {moreLabel && (hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-3 text-xs underline-offset-2 hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          {expanded ? t("common:buttons.showLess") : moreLabel(hidden)}
        </button>
      )}
    </div>
  );
}
