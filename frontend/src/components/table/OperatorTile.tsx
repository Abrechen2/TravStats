import { useEffect, useState, type JSX } from "react";
import { operatorMonogram } from "../../lib/operatorMonogram";
import { Icon } from "../ui/Icon";

/** The airline tile's size, so the logbooks' leading marks line up. */
const TILE_PX = 44;

type TileDomain = "rail" | "rental" | "bus";

const DOMAIN: Record<TileDomain, { colour: string; icon: "train-front" | "car" | "bus" }> = {
  rail: { colour: "var(--ts-domain-rail)", icon: "train-front" },
  rental: { colour: "var(--ts-domain-rental)", icon: "car" },
  bus: { colour: "var(--ts-domain-bus)", icon: "bus" },
};

interface Props {
  /** The operator or provider as recorded; null when none is. */
  name: string | null;
  domain: TileDomain;
  /**
   * Where the provider's logo would come from, if anywhere (forgejo#196 —
   * rentals only so far). A 404 or a broken image falls back to the
   * monogram, exactly as `AirlineWordmarkCell` falls back to its code tile:
   * a missing logo is shown as missing, never replaced by a wrong one.
   */
  logoUrl?: string | null;
}

/** The logo URL of a rental provider, by the name the rental records. */
export function rentalProviderLogoUrl(provider: string | null): string | null {
  const name = provider?.trim();
  return name ? `/api/v1/rentals/providers/logo?name=${encodeURIComponent(name)}` : null;
}

/**
 * The leading mark of a rail, rental or bus row (forgejo#197): the airline
 * tile's shape, with the provider's LOGO where one is known and a MONOGRAM on
 * the domain colour otherwise.
 *
 * The name is the tooltip and, for a screen reader, the tile's text; the
 * letters themselves are hidden from it, since "D B" read aloud says less
 * than "DB Fernverkehr".
 */
export function OperatorTile({ name, domain, logoUrl }: Props): JSX.Element {
  const { colour, icon } = DOMAIN[domain];
  const letters = operatorMonogram(name);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [logoUrl]);
  const showLogo = Boolean(logoUrl) && !logoFailed;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden"
      title={name ?? undefined}
      data-testid="operator-tile"
      style={{
        width: TILE_PX,
        height: TILE_PX,
        borderRadius: "var(--ts-radius-button)",
        background: showLogo ? "var(--ts-tile)" : letters ? colour : "var(--ts-tile)",
        color: letters ? "var(--ts-bg)" : colour,
        fontFamily: "var(--ts-font-mono)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {showLogo ? (
        <>
          <img
            src={logoUrl ?? undefined}
            alt=""
            aria-hidden="true"
            data-testid="operator-logo"
            width={TILE_PX}
            height={TILE_PX}
            style={{ objectFit: "contain" }}
            onError={(): void => setLogoFailed(true)}
          />
          <span className="sr-only">{name}</span>
        </>
      ) : letters ? (
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
