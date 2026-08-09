// TravStats brand system — final logo (v1.0, locked 2026-04-18).
//
// The mark is a luggage-tag silhouette with the "TS" monogram and a
// version micro-line (major.minor of the app generation, bumped per major
// release). The wordmark is Inter Medium with a cross-dot glyph
// between TRAV and STATS. All surfaces read `color` as a hex string or
// CSS variable; callers should pass `var(--accent)` / `var(--text-primary)`
// to inherit the app's theme tokens.

import type { CSSProperties } from "react";

interface LogoMarkProps {
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

interface LogoMarkFilledProps extends LogoMarkProps {
  // Inverse colour printed on top of the filled tag (TS, rule line, bottom
  // wordmark, lace hole). Defaults to the app's base background so the mark
  // stays legible whether the theme is dark or light.
  bg?: string;
}

interface LogoWordmarkProps {
  size?: number;
  color?: string;
  accent?: string;
  className?: string;
  style?: CSSProperties;
}

interface LogoLockupProps extends LogoWordmarkProps {
  markSize?: number;
  markColor?: string;
  gap?: number;
  layout?: "stacked" | "horizontal";
}

const TAG_PATH = "M 28 36 L 60 10 L 92 36 L 92 126 Q 92 132 86 132 L 34 132 Q 28 132 28 126 Z";
const TAG_RULES = "M 38 52 L 82 52 M 38 62 L 82 62";

// Primary mark — Luggage Tag A outline.
export function LogoMark({
  size = 48,
  color = "var(--accent)",
  className,
  style,
  title = "TravStats",
}: LogoMarkProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 140"
      width={size}
      height={(size * 140) / 120}
      role="img"
      className={className}
      style={{ display: "block", ...style }}
    >
      <title>{title}</title>
      <path d={TAG_PATH} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <circle cx="60" cy="28" r="5" fill="none" stroke={color} strokeWidth="3" />
      <path d={TAG_RULES} stroke={color} strokeWidth="1.5" strokeOpacity="0.5" />
      <text
        x="60"
        y="96"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="32"
        fontWeight="700"
        fill={color}
        letterSpacing="-1"
      >
        TS
      </text>
      {/* No version string on the mark: the brand source of truth defines it as
          a bare outline luggage tag, and a hardcoded "V2.0" was still riding
          along on the 2.5 release. */}
    </svg>
  );
}

// Alt mark — Luggage Tag B filled. Use at small sizes (favicons, app icons).
export function LogoMarkFilled({
  size = 48,
  color = "var(--accent)",
  bg = "var(--bg-base)",
  className,
  style,
  title = "TravStats",
}: LogoMarkFilledProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 140"
      width={size}
      height={(size * 140) / 120}
      role="img"
      className={className}
      style={{ display: "block", ...style }}
    >
      <title>{title}</title>
      <path d={TAG_PATH} fill={color} stroke={color} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="60" cy="28" r="5" fill={bg} />
      <text
        x="60"
        y="92"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="34"
        fontWeight="800"
        fill={bg}
        letterSpacing="-1.5"
      >
        TS
      </text>
      <line x1="40" y1="104" x2="80" y2="104" stroke={bg} strokeWidth="1.5" opacity="0.5" />
      <text
        x="60"
        y="118"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize="7"
        fontWeight="600"
        fill={bg}
        letterSpacing="2"
      >
        TRAVSTATS
      </text>
    </svg>
  );
}

// Wordmark — TRAV + cross-dot + STATS. Medium 500, 0.06em tracking.
export function LogoWordmark({
  size = 24,
  color = "var(--text-primary)",
  accent = "var(--accent)",
  className,
  style,
}: LogoWordmarkProps): JSX.Element {
  const dot = Math.max(8, Math.round(size * 0.48));
  return (
    <span
      className={className}
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "0.06em",
        color,
        lineHeight: 1,
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        display: "inline-flex",
        alignItems: "center",
        ...style,
      }}
    >
      <span>TRAV</span>
      <svg
        width={dot}
        height={dot}
        viewBox="0 0 20 20"
        aria-hidden="true"
        style={{ margin: `0 ${Math.round(size * 0.14)}px`, flexShrink: 0 }}
      >
        <line
          x1="10"
          y1="3"
          x2="10"
          y2="17"
          stroke={accent}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="3"
          y1="10"
          x2="17"
          y2="10"
          stroke={accent}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span>STATS</span>
    </span>
  );
}

// Combined lockup — mark + wordmark. Default stacked (hero), horizontal
// for headers / inline usage.
export function LogoLockup({
  size = 24,
  markSize,
  color = "var(--text-primary)",
  accent = "var(--accent)",
  markColor,
  gap,
  layout = "horizontal",
  className,
  style,
}: LogoLockupProps): JSX.Element {
  const resolvedMark = markSize ?? size * 2;
  const resolvedGap = gap ?? (layout === "stacked" ? size * 0.75 : size * 0.5);
  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: layout === "stacked" ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: resolvedGap,
        ...style,
      }}
    >
      <LogoMark size={resolvedMark} color={markColor ?? accent} />
      <LogoWordmark size={size} color={color} accent={accent} />
    </div>
  );
}
