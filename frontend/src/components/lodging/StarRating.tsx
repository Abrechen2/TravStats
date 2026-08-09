import type { JSX } from "react";

const MAX_STARS = 5;
const FULL = "★";
const HALF = "⯪";
const FALLBACK = "—";

interface StarRatingProps {
  /** Rating on a 1–`max` scale, or `null` when unrated. */
  value: number | null;
  max?: number;
  className?: string;
}

/**
 * Renders a rating as filled/half/muted star glyphs plus the plain numeric
 * value (mockup screens ①/②: `★★★★<off>★</off> 4.3`), replacing the bare
 * "★ 4" text `formatRatingText` produced. The numeric value is always kept
 * alongside the glyphs — rating is NOT colour-only, so it stays legible for
 * colourblind users and keeps meaning even if `--star` isn't rendered.
 *
 * Rounds to the nearest half-star for the glyphs (`Math.round(value * 2) /
 * 2`) — the backend already rounds `overallRating`/`ratingOverall` to one
 * decimal, so this only ever refines that into a half-star STEP, never a
 * second independent rounding of the underlying data.
 */
export function StarRating({ value, max = MAX_STARS, className }: StarRatingProps): JSX.Element {
  if (value === null) {
    return <span className={className}>{FALLBACK}</span>;
  }
  const rounded = Math.round(value * 2) / 2;
  const filled = Math.min(max, Math.max(0, Math.floor(rounded)));
  const half = filled < max && rounded - filled === 0.5 ? 1 : 0;
  const empty = Math.max(0, max - filled - half);

  return (
    <span className={className}>
      <span aria-hidden style={{ color: "var(--star, #f2b950)", letterSpacing: 1 }}>
        {FULL.repeat(filled)}
        {half === 1 && HALF}
        <span style={{ color: "var(--text-faint, #5c6878)" }}>{FULL.repeat(empty)}</span>
      </span>{" "}
      {value}
    </span>
  );
}
