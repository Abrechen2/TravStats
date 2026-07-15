import type { Flight } from "../../types";
import AirlineLogo from "../AirlineLogo";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";

/**
 * Airline column cell: a departures-board style brand tile (owner reference:
 * airport departure boards). The written airline name is deliberately NOT shown
 * next to it (owner decision 2026-07-12) — it stays as the title tooltip and as
 * the text fallback when no logo resolves.
 *
 * The tile is rendered BARE. Every tier of the logo chain now returns an image
 * that carries its own background: kiwi's keyless brand tile does, and so does
 * a logostream wordmark. Painting anything behind it would be a second
 * background — which is precisely what 2.5.0-beta.1 shipped (a navy crane on a
 * navy plate: invisible) and what beta.2's luminance heuristic only half fixed.
 * There is nothing left for this component to decide.
 */
const TILE_PX = 44;

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
        size={TILE_PX}
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
