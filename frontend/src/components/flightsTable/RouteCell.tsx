import type { Flight } from "../../types";
import { FlagImg } from "../../lib/countryFlag";

/** Route cell: SVG flags + IATA codes with a plane connector, airport names below. */
export default function RouteCell({ flight }: { flight: Flight }): JSX.Element {
  const namesTitle =
    flight.depName && flight.arrName ? `${flight.depName} → ${flight.arrName}` : undefined;
  return (
    <div className="max-w-[16rem]">
      <div className="flex items-center gap-1.5">
        <FlagImg country={flight.depCountry} height={12} />
        <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>
          {flight.depIata || flight.depIcao}
        </span>
        <span className="inline-flex items-center opacity-60" style={{ color: "var(--text-muted)" }}>
          <span className="inline-block w-3 h-px" style={{ background: "var(--color-border)" }} />
          <span className="text-[16px] mx-0.5 inline-block" style={{ transform: "rotate(45deg)" }}>✈</span>
          <span className="inline-block w-3 h-px" style={{ background: "var(--color-border)" }} />
        </span>
        <FlagImg country={flight.arrCountry} height={12} />
        <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>
          {flight.arrIata || flight.arrIcao}
        </span>
      </div>
      <div className="text-xs truncate" style={{ color: "var(--text-muted)" }} title={namesTitle}>
        {flight.depName} → {flight.arrName}
      </div>
    </div>
  );
}
