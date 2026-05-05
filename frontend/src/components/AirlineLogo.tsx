import { useState, useMemo } from "react";

/**
 * Airline logo via Daisycon's public CDN, with a graceful fall back to a
 * stylised IATA letter box when the CDN does not have the airline (rare
 * regional carriers) or when the request fails.
 *
 * Daisycon offers free, commercial-use airline logos by IATA code:
 *   https://daisycon.io/images/airline/?iata=LH&width=300&height=150
 *
 * The component is designed to be drop-in for any flight chip / row /
 * map marker. It owns its own error state so a single broken request
 * doesn't bubble up to the consumer.
 */

const DAISYCON_BASE = "https://daisycon.io/images/airline/";

interface AirlineLogoProps {
  /** IATA code (preferred). */
  iata?: string | null;
  /** ICAO code (used only if iata is missing — Daisycon supports both). */
  icao?: string | null;
  /** Flight number — fallback when iata/icao are absent (parses prefix). */
  flightNumber?: string | null;
  /** Square pixel size of the logo. Default: 32 */
  size?: number;
  /** Background color (hex without #). Default: transparent → white BG. */
  bg?: string;
  /** Extra class names for the wrapper. */
  className?: string;
  /** Accessible label (defaults to airline display name or IATA code). */
  alt?: string;
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
  size: number;
  bg?: string;
}): string | null {
  const { iata, icao, size, bg } = params;
  if (!iata && !icao) return null;
  const search = new URLSearchParams();
  if (iata) search.set("iata", iata);
  else if (icao) search.set("icao", icao);
  search.set("width", String(size * 4)); // request higher-res for retina
  search.set("height", String(size * 4));
  if (bg) search.set("color", bg);
  return `${DAISYCON_BASE}?${search.toString()}`;
}

export default function AirlineLogo({
  iata,
  icao,
  flightNumber,
  size = 32,
  bg,
  className,
  alt,
}: AirlineLogoProps): JSX.Element {
  const [errored, setErrored] = useState(false);

  const resolvedIata = useMemo(
    () => iata?.toUpperCase() || deriveIata(flightNumber),
    [iata, flightNumber]
  );
  const resolvedIcao = useMemo(() => icao?.toUpperCase() || undefined, [icao]);

  const url = useMemo(
    () => buildUrl({ iata: resolvedIata, icao: resolvedIcao, size, bg }),
    [resolvedIata, resolvedIcao, size, bg]
  );

  const fallbackLabel = resolvedIata || resolvedIcao || "?";
  const accessibleAlt = alt ?? (resolvedIata ? `${resolvedIata} logo` : "Airline logo");

  if (!url || errored) {
    return (
      <span
        className={
          className ??
          "inline-flex items-center justify-center rounded font-semibold text-[var(--text-muted)] bg-[var(--bg-elevated)]"
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
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className={className ?? "rounded object-contain bg-white/90"}
      style={{ width: size, height: size }}
    />
  );
}
