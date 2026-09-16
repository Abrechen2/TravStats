import type { Flight } from "../../types";
import AirlineLogo from "../AirlineLogo";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";

/**
 * Airline column cell: a departures-board style brand tile (owner reference:
 * airport departure boards). The written airline name is deliberately NOT shown
 * next to it (owner decision 2026-07-12) — it stays as the title tooltip and as
 * the text fallback when no logo resolves.
 *
 * The tile sits on a neutral light plate. The premise this component used to
 * carry — that every tier returns an image with its own background — does not
 * hold: measured on 2.5.0-beta.3, kiwi's Lufthansa tile is 94% transparent
 * with a dark navy crane, and carriers that fall through to Daisycon get a
 * wide transparent wordmark. Bare on the dark UI both are invisible.
 *
 * A plate is safe precisely because it is a BACKGROUND: it shows only through
 * transparent pixels and is fully covered by an opaque tile, so Air France and
 * KLM render identically with and without it (verified side by side in the
 * browser). That is the difference from the 2.5.0-beta.1 defect, which painted
 * the plate in the airline's OWN brand colour and hid the mark on top of it.
 *
 * Note the plate is also AirlineLogo's default className; this cell dropped it
 * by overriding className wholesale.
 */
const TILE_PX = 44;

export default function AirlineWordmarkCell({ flight }: { flight: Flight }): JSX.Element {
  const name = resolveAirlineDisplay(flight);
  const iata = resolveAirlineIata(flight);

  // A tile the size of a logo, with the code in it. The name used to stand
  // here as text, and in a 48px column "Lufthansa" ran straight into the
  // flight number next to it ("LufthansaLH2462", CT106 audit B01). The name
  // stays for a screen reader and in the tooltip.
  const code = (iata || name || flight.flightNumber || "").slice(0, 3).toUpperCase();
  const fallback = (
    <span
      className="inline-flex items-center justify-center"
      style={{
        width: TILE_PX,
        height: TILE_PX,
        borderRadius: "var(--ts-radius-button)",
        background: "var(--ts-tile)",
        color: "var(--ts-text-bright)",
        fontFamily: "var(--ts-font-mono)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span aria-hidden="true">{code || "—"}</span>
      <span className="sr-only">{name || flight.flightNumber || "—"}</span>
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
        className="rounded-sm object-contain max-w-none bg-white/90"
        alt={name ?? "Airline logo"}
        fallback={fallback}
      />
    </span>
  );
}
