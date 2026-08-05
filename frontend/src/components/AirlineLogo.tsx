import { useState, useMemo } from "react";

/**
 * Airline logo via the backend proxy (GET /api/v1/airline-logos/:code),
 * which resolves logostream.dev (icon/wordmark/dark variants, SVG) and
 * falls back to Daisycon server-side. Auth rides on the JWT cookie —
 * same-origin <img> requests send it automatically. Falls back to a
 * stylised IATA letter box when no logo resolves or the request fails.
 */

export type AirlineLogoVariant = "icon" | "logo" | "logo-white" | "tail";

interface AirlineLogoProps {
  /** IATA code (preferred). */
  iata?: string | null;
  /** ICAO code (used only if iata is missing — backend proxy supports both). */
  icao?: string | null;
  /** Flight number — fallback when iata/icao are absent (parses prefix). */
  flightNumber?: string | null;
  /** Square pixel size of the logo. Default: 32 */
  size?: number;
  /** Background color (deprecated, no-op). Kept for source compatibility. */
  bg?: string;
  /** Logo variant. Default: "icon". */
  variant?: AirlineLogoVariant;
  /** Extra class names for the wrapper. */
  className?: string;
  /** Accessible label (defaults to airline display name or IATA code). */
  alt?: string;
  /**
   * Custom fallback rendered instead of the letterbox when the image
   * errors or no code resolves. Left undefined to keep the default
   * letterbox behaviour.
   */
  fallback?: React.ReactNode;
  /**
   * Width of the rendered image box, in pixels. When set, the img gets a
   * `width` × `size` box instead of a square one — `object-contain` (via
   * `className`) keeps the logo's own aspect ratio inside it. Defaults to
   * `size` (square).
   */
  width?: number;
}

/** Derive IATA from flight number prefix when no explicit code is given. */
function deriveIata(flightNumber?: string | null): string | undefined {
  if (!flightNumber) return undefined;
  const match = flightNumber.trim().match(/^([A-Z0-9]{2,3})/i);
  if (!match) return undefined;
  const candidate = match[1].toUpperCase();
  // Daisycon expects 2-character IATA — drop 3-char ICAO-ish prefixes.
  return candidate.length === 2 ? candidate : undefined;
}

function buildUrl(params: {
  iata?: string;
  icao?: string;
  variant: AirlineLogoVariant;
}): string | null {
  const code = params.iata ?? params.icao;
  if (!code) return null;
  return `/api/v1/airline-logos/${encodeURIComponent(code)}?variant=${params.variant}`;
}

export default function AirlineLogo({
  iata,
  icao,
  flightNumber,
  size = 32,
  bg: _bg,
  variant = "icon",
  className,
  alt,
  fallback,
  width,
}: AirlineLogoProps): JSX.Element {
  const [errored, setErrored] = useState(false);

  const resolvedIata = useMemo(
    () => iata?.toUpperCase() || deriveIata(flightNumber),
    [iata, flightNumber]
  );
  const resolvedIcao = useMemo(() => icao?.toUpperCase() || undefined, [icao]);

  const url = useMemo(
    () => buildUrl({ iata: resolvedIata, icao: resolvedIcao, variant }),
    [resolvedIata, resolvedIcao, variant]
  );

  const fallbackLabel = resolvedIata || resolvedIcao || "?";
  const accessibleAlt = alt ?? (resolvedIata ? `${resolvedIata} logo` : "Airline logo");

  if (!url || errored) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <span
        className={
          className ??
          "inline-flex items-center justify-center rounded-sm font-semibold text-(--text-muted) bg-(--bg-elevated)"
        }
        style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
        aria-label={accessibleAlt}
        role="img"
      >
        {fallbackLabel}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={accessibleAlt}
      width={width ?? size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className={className ?? "rounded-sm object-contain bg-white/90"}
      style={{ width: width ?? size, height: size }}
    />
  );
}
