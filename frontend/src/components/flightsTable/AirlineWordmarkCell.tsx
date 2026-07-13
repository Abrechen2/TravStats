import type { Flight } from "../../types";
import AirlineLogo from "../AirlineLogo";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";
import { useAirlineLogoManifest } from "../../hooks/useAirlineLogoManifest";

/**
 * Airline column cell: a departures-board style brand tile (owner reference:
 * airport departure boards). The written airline name is deliberately NOT shown
 * next to it (owner decision 2026-07-12) — it stays as the title tooltip and as
 * the text fallback when no logo resolves.
 *
 * The tile comes in two shapes, because the two logo tiers ship two different
 * kinds of asset:
 *
 *  - **Keyless default** (the vendored snapshot): square brand MARKS —
 *    Lufthansa's crane, not a "Lufthansa" wordmark. The mark is drawn IN the
 *    airline's brand colour (the crane's own fill is #05164d), so it needs a
 *    contrasting plate under it, not the brand colour: painting navy on navy
 *    renders an invisible logo, which is exactly what the first beta shipped.
 *    The plate therefore follows the mark's luminance — light marks get a dark
 *    plate, dark marks a light one.
 *  - **Premium** (logostream, when an admin configured a key): a wordmark that
 *    already ships its own background. It renders bare, as before — putting a
 *    plate behind it would double the background.
 *
 * The manifest tells us which tier will answer. Guessing per row is not possible:
 * the same code resolves differently depending on a server-side setting.
 */

/**
 * Perceived brightness of a `#rrggbb` colour (ITU-R BT.601), 0–1. Used only to
 * decide whether the mark needs a light or a dark plate under it.
 */
function isDark(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length !== 6) return true;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}
export default function AirlineWordmarkCell({ flight }: { flight: Flight }): JSX.Element {
  const { brands } = useAirlineLogoManifest();
  const name = resolveAirlineDisplay(flight);
  const iata = resolveAirlineIata(flight);
  const code = (iata ?? flight.airlineIcao ?? "").toUpperCase();
  const brand = code ? brands[code] : undefined;

  const fallback = (
    <span className="font-medium" style={{ color: "var(--text-primary)" }}>
      {name || flight.flightNumber || "—"}
    </span>
  );

  if (brand) {
    // The mark carries the brand colour; the plate carries the contrast.
    const plate = isDark(brand.color) ? "#ffffff" : "#0d1117";
    return (
      <span title={name ?? undefined}>
        <span
          className="inline-flex items-center justify-center rounded"
          style={{ width: 56, height: 56, background: plate }}
        >
          <AirlineLogo
            iata={iata}
            icao={flight.airlineIcao}
            flightNumber={flight.flightNumber}
            variant="logo"
            size={40}
            width={40}
            className="object-contain max-w-none"
            alt={name ?? "Airline logo"}
            fallback={fallback}
          />
        </span>
      </span>
    );
  }

  return (
    <span title={name ?? undefined}>
      <AirlineLogo
        iata={iata}
        icao={flight.airlineIcao}
        flightNumber={flight.flightNumber}
        variant="logo"
        size={56}
        width={146}
        // max-w-none: Tailwind's preflight sets img { max-width: 100% }, and
        // Firefox's auto table layout computes this column narrower than
        // Chrome — the cap would shrink the tile to the cell width there.
        className="rounded object-contain max-w-none"
        alt={name ?? "Airline logo"}
        fallback={fallback}
      />
    </span>
  );
}
