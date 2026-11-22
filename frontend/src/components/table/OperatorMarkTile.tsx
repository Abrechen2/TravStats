import type { JSX } from "react";
import { useOperatorLogo } from "../map/cards/journeys/operatorLogo";
import { OperatorTile } from "./OperatorTile";

/**
 * An operator's tile where the logo comes from the name-keyed operator service
 * (`/operators/mark` says whether there is one, `/operators/logo` serves it):
 * bus companies, ferry lines and cruise lines. Until the server has said yes —
 * and for good on a miss — `OperatorTile` draws the monogram on the domain
 * colour, so a list row and its detail header answer the same way.
 */
export function OperatorMarkTile({
  name,
  domain,
  size,
}: {
  name: string | null;
  domain: "rail" | "bus" | "ferry" | "cruise";
  size?: number;
}): JSX.Element {
  const logo = useOperatorLogo(domain, name ?? "");
  return <OperatorTile name={name} domain={domain} logoUrl={logo?.url ?? null} size={size} />;
}
