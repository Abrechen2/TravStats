import type { Flight } from "../../types";
import AirlineLogo from "../AirlineLogo";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";

/**
 * Airline column cell: the carrier's wordmark logo on a white chip (dark
 * logos stay readable on the dark theme). The written airline name is
 * deliberately NOT shown next to it (owner decision 2026-07-12) — it
 * remains available as the chip's title tooltip and as the text fallback
 * when no logo resolves.
 *
 * The white chip is the `<img>`'s OWN className (no outer wrapper span) —
 * that way the error/no-code fallback (plain airline-name text) renders
 * without the chip automatically, since `AirlineLogo` swaps the whole
 * element out in that branch.
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
        size={28}
        width={96}
        className="bg-white rounded-md px-2 py-1 object-contain"
        alt={name ?? "Airline logo"}
        fallback={fallback}
      />
    </span>
  );
}
