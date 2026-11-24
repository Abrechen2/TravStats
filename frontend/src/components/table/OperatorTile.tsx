import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { operatorMonogram } from "../../lib/operatorMonogram";
import { Icon } from "../ui/Icon";

/** The airline tile's size, so the logbooks' leading marks line up. */
const TILE_PX = 44;

type TileDomain = "rail" | "rental" | "bus" | "ferry" | "flight" | "cruise";

const DOMAIN: Record<
  TileDomain,
  { colour: string; icon: "train-front" | "car" | "bus" | "ship" | "plane" }
> = {
  rail: { colour: "var(--ts-domain-rail)", icon: "train-front" },
  rental: { colour: "var(--ts-domain-rental)", icon: "car" },
  ferry: { colour: "var(--ts-domain-ferry)", icon: "ship" },
  bus: { colour: "var(--ts-domain-bus)", icon: "bus" },
  flight: { colour: "var(--ts-domain-flight)", icon: "plane" },
  cruise: { colour: "var(--ts-domain-cruise)", icon: "ship" },
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
  /** Edge length in px. The logbook rows use the airline tile's 44; a map card 32. */
  size?: number;
  /**
   * The domain colour as the colour store resolves it. The logbooks use the
   * brand CSS variable; the map card passes the store's value, so a user who
   * repainted rail sees the new colour on the line AND on its card.
   */
  colour?: string;
  /** The operator was inferred, not entered: a marker and a tooltip say so. */
  inferred?: boolean;
}

/** The logo URL of a rental provider, by the name the rental records. */
export function rentalProviderLogoUrl(provider: string | null): string | null {
  const name = provider?.trim();
  return name ? `/api/v1/rentals/providers/logo?name=${encodeURIComponent(name)}` : null;
}

/** The logo URL of a rail operator, by the name a journey records (catalogue only). */
export function railOperatorLogoUrl(operator: string | null): string | null {
  const name = operator?.trim();
  return name ? `/api/v1/rail/operators/logo?name=${encodeURIComponent(name)}` : null;
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
export function OperatorTile({
  name,
  domain,
  logoUrl,
  size = TILE_PX,
  colour: colourOverride,
  inferred = false,
}: Props): JSX.Element {
  const { t } = useTranslation(["common"]);
  const { colour: brandColour, icon } = DOMAIN[domain];
  const colour = colourOverride ?? brandColour;
  const letters = operatorMonogram(name);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [logoUrl]);
  const showLogo = Boolean(logoUrl) && !logoFailed;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden"
      title={name ? (inferred ? `${name} – ${t("common:operatorInferred")}` : name) : undefined}
      data-testid="operator-tile"
      style={{
        width: size,
        height: size,
        borderRadius: "var(--ts-radius-button)",
        background: showLogo ? "var(--ts-tile)" : letters ? colour : "var(--ts-tile)",
        color: letters ? "var(--ts-bg)" : colour,
        fontFamily: "var(--ts-font-mono)",
        fontSize: size < TILE_PX ? 11 : 12,
        fontWeight: 700,
      }}
    >
      {inferred ? (
        // A muted "~" on the monogram's colour (or over a logo) was not visible at all
        // (UAT rc.45): it is a small chip in the page's own colours now, above the logo. The
        // explanation is the tile's own tooltip (name – "abgeleitet …"), which covers the chip.
        <span
          aria-hidden="true"
          data-testid="operator-inferred"
          style={{
            position: "absolute",
            right: 1,
            bottom: 1,
            zIndex: 1,
            fontSize: 11,
            lineHeight: 1,
            padding: "1px 3px",
            borderRadius: 4,
            background: "var(--ts-bg)",
            color: "var(--ts-text)",
          }}
        >
          ~
        </span>
      ) : null}
      {showLogo ? (
        <>
          <img
            src={logoUrl ?? undefined}
            alt=""
            aria-hidden="true"
            data-testid="operator-logo"
            width={size}
            height={size}
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
        <Icon name={icon} size={size < TILE_PX ? 16 : 20} />
      )}
    </span>
  );
}
