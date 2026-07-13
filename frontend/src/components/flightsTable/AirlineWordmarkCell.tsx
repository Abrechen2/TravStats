import type { Flight } from "../../types";
import AirlineLogo from "../AirlineLogo";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";

/**
 * Airline column cell: the carrier's wordmark logo as a departures-board
 * style brand tile — the `variant="logo"` asset ships its own brand
 * background (logostream's `*_logo_bg`), so it renders directly without
 * any chip around it (owner reference: airport departure boards). The
 * written airline name is deliberately NOT shown next to it (owner
 * decision 2026-07-12) — it remains available as the title tooltip and
 * as the text fallback when no logo resolves.
 */
export default function AirlineWordmarkCell({ flight }: { flight: Flight }): JSX.Element {
  const name = resolveAirlineDisplay(flight);
  const iata = resolveAirlineIata(flight);
  const fallback = (
    <span className="font-medium" style={{ color: "var(--text-primary)" }}>
      {name || flight.flightNumber || "—"}
    </span>
  );

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
