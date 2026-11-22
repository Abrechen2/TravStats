import type { JSX } from "react";
import AirlineWordmarkCell from "../flightsTable/AirlineWordmarkCell";
import { OperatorMarkTile } from "../table/OperatorMarkTile";
import { OperatorTile, railOperatorLogoUrl, rentalProviderLogoUrl } from "../table/OperatorTile";
import type { TripSuggestionMember } from "../../types/tripSuggestion";

const MARK_PX = 28;

/** The domain colour a proposal member is accented with (a left border, never the whole row). */
export function memberAccent(domain: TripSuggestionMember["domain"]): string {
  const name = domain === "place" ? "poi" : domain === "lodging" ? "hotel" : domain;
  return `var(--ts-domain-${name})`;
}

/**
 * The carrier's mark for a proposed trip member, the same tile the logbook and
 * the trip timeline draw (the airline logo honours the user's tile/icon style).
 * A member with no operator source — a stay, a place, a tour, a roadtrip — has
 * no mark; its domain label and accent colour stay.
 */
export default function TripMemberMark({
  member,
}: {
  member: TripSuggestionMember;
}): JSX.Element | null {
  const { domain, operator, airlineIata } = member;
  switch (domain) {
    case "flight":
      if (!operator && !airlineIata) return null;
      return <AirlineWordmarkCell flight={{ airline: operator, airlineIata }} size={MARK_PX} />;
    case "rail":
      return (
        <OperatorTile
          name={operator ?? null}
          domain="rail"
          logoUrl={railOperatorLogoUrl(operator ?? null)}
          size={MARK_PX}
        />
      );
    case "rental":
      return (
        <OperatorTile
          name={operator ?? null}
          domain="rental"
          logoUrl={rentalProviderLogoUrl(operator ?? null)}
          size={MARK_PX}
        />
      );
    case "bus":
    case "ferry":
    case "cruise":
      return <OperatorMarkTile name={operator ?? null} domain={domain} size={MARK_PX} />;
    default:
      return null;
  }
}
