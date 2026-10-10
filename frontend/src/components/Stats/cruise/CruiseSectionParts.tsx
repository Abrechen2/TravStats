import type { JSX } from "react";

/**
 * The drawing parts of the cruise tab (`CruiseStatsSection`) that carry no
 * figure of their own to explain: the region bars, the sea-day donut, the tag
 * clouds and the flag pills. Split out so the section stays under the file-size
 * limit while it gained its counting help (forgejo#257); the section still
 * draws every figure and its "So wird gezählt".
 */

export type TFunction = (key: string, options?: Record<string, unknown>) => string;

export function RegionBars({
  regionVisitCounts,
  title,
  emptyHint,
  t,
}: {
  regionVisitCounts: Record<string, number>;
  title: string;
  emptyHint: string;
  t: TFunction;
}): JSX.Element {
  const sorted = Object.entries(regionVisitCounts).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] ?? 0;

  return (
    <div
      className="rounded-lg p-4 h-full"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      {sorted.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {emptyHint}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.slice(0, 8).map(([region, count]) => (
            <li key={region} className="flex items-center gap-3 text-xs">
              {/* Wraps instead of truncating behind a hover title: a title is
                  out of reach by touch and keyboard (helpReachability). */}
              <span className="w-32 shrink-0 break-words" style={{ color: "var(--text-primary)" }}>
                {prettyRegion(region, t)}
              </span>
              <div
                className="flex-1 h-3 rounded-full overflow-hidden"
                style={{ background: "var(--bg-elevated)" }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${max > 0 ? (count / max) * 100 : 0}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
              <span className="w-8 text-right font-mono" style={{ color: "var(--text-primary)" }}>
                {count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SeaDayDonut({
  seaDays,
  totalDays,
  pct,
  label,
}: {
  seaDays: number;
  totalDays: number;
  pct: number;
  label: string;
}): JSX.Element {
  // Conic-gradient donut — no chart lib needed. Inner label shows the
  // percentage; subtitle explains the ratio.
  const trackColor = "var(--bg-elevated)";
  const fillColor = "var(--accent)";
  const gradient = `conic-gradient(${fillColor} 0deg ${pct * 3.6}deg, ${trackColor} ${pct * 3.6}deg 360deg)`;

  return (
    <div
      className="rounded-lg p-4 h-full flex flex-col items-center justify-center"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-sm font-medium mb-3 self-start" style={{ color: "var(--text-muted)" }}>
        {label}
      </h3>
      <div
        className="relative w-32 h-32 rounded-full"
        style={{ background: gradient }}
        aria-label={`${pct}%`}
      >
        <div
          className="absolute inset-3 rounded-full flex items-center justify-center"
          style={{ background: "var(--bg-surface)" }}
        >
          <span className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>
            {pct}%
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
        {seaDays} / {totalDays} d
      </p>
    </div>
  );
}

export function TagCloud({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {items.map((label) => (
          <span
            key={label}
            className="px-2 py-0.5 rounded-full text-xs"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--color-border)",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Flag({ label, emoji }: { label: string; emoji: string }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md"
      style={{
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </span>
  );
}

/**
 * Region slug -> display label, via i18n.
 *
 * This used to read from a hardcoded German map of TEN slugs while the port
 * catalogue uses FIFTY-FOUR. Everything unmapped fell through to the
 * title-case fallback, so a German UI showed "Mittelmeer" and "Ostsee" next to
 * "North Sea", "Aegean" and "Iberian Atlantic" — which read like mixed data but
 * was simply an incomplete map. The German labels were also hardcoded, so an
 * English UI got German names for the ten that WERE mapped.
 *
 * The fallback stays: a slug the catalogue gains before the translations do
 * renders readably instead of blank.
 */
export function prettyRegion(slug: string, t: TFunction): string {
  const translated = t(`stats:cruiseSection.regions.${slug}`);
  // i18next echoes the key back when it has no entry.
  if (translated && !translated.endsWith(`.${slug}`)) return translated;
  return slug
    .split(/[_\s]+/)
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");
}
