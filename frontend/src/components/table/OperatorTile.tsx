import type { JSX } from "react";
import { operatorMonogram } from "../../lib/operatorMonogram";
import { Icon } from "../ui/Icon";

/** The airline tile's size, so the logbooks' leading marks line up. */
const TILE_PX = 44;

type TileDomain = "rail" | "rental";

const DOMAIN: Record<TileDomain, { colour: string; icon: "train-front" | "car" }> = {
  rail: { colour: "var(--ts-domain-rail)", icon: "train-front" },
  rental: { colour: "var(--ts-domain-rental)", icon: "car" },
};

interface Props {
  /** The operator or provider as recorded; null when none is. */
  name: string | null;
  domain: TileDomain;
}

/**
 * The leading mark of a rail or rental row (forgejo#197): the airline tile's
 * shape, with a MONOGRAM on the domain colour instead of a logo.
 *
 * No logo is fetched or vendored on purpose — where operator and provider
 * logos would come from is an open owner question, and the airline chain
 * shows what a wrong answer costs. When a source is decided it slots in here,
 * with the monogram as its fallback, exactly as `AirlineWordmarkCell` falls
 * back to its code tile.
 *
 * The name is the tooltip and, for a screen reader, the tile's text; the
 * letters themselves are hidden from it, since "D B" read aloud says less
 * than "DB Fernverkehr".
 */
export function OperatorTile({ name, domain }: Props): JSX.Element {
  const { colour, icon } = DOMAIN[domain];
  const letters = operatorMonogram(name);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      title={name ?? undefined}
      data-testid="operator-tile"
      style={{
        width: TILE_PX,
        height: TILE_PX,
        borderRadius: "var(--ts-radius-button)",
        background: letters ? colour : "var(--ts-tile)",
        color: letters ? "var(--ts-bg)" : colour,
        fontFamily: "var(--ts-font-mono)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {letters ? (
        <>
          <span aria-hidden="true">{letters}</span>
          <span className="sr-only">{name}</span>
        </>
      ) : (
        <Icon name={icon} size={20} />
      )}
    </span>
  );
}
