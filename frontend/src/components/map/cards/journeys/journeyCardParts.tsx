// The furniture a journey card adds to the shared card chrome: the domain
// badge, an end with its flag, the operator mark and the journey list.
//
// The owner's 2026-10-20 note — the flags "haben es extrem aufgewertet" — is
// why each piece carries identity rather than plain text: the badge is the
// domain's own logbook icon on its own colour, every place has its flag, and
// the operator has its mark (a logo where one is known, else a monogram on the
// domain colour — never a broken image, `OperatorTile`).

import { useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { FlagImg, countryName } from "../../../../lib/countryFlag";
import { DOMAINS } from "../../../../shared/domains";
import { tokens } from "../../../../theme/tokens";
import { Icon } from "../../../ui/Icon";
import type { IconName } from "../../../ui/icons/lucide";
import { OperatorTile } from "../../../table/OperatorTile";
import { LABEL_STYLE, type TFn } from "../cardChrome";
import { formatTimeValueShown } from "../../../../lib/displayFormat";
import type { Rgb } from "../../../../lib/domainColor";
import type { JourneyDomain, JourneyEnd, MapJourney } from "./journeyTypes";
import { rgbCss } from "./journeyIdentity";
import { useOperatorLogo } from "./operatorLogo";

/** The journey's day as its departure place saw it, in the user's date format; "" when undated. */
export function journeyDay(j: MapJourney): string {
  return j.departure ? formatTimeValueShown(j.departure, { dateOnly: true }) : "";
}

/** The domain's icon on a tint of its colour — the journey card's flag. */
export function DomainBadge({
  icon,
  color,
  size = 24,
}: {
  icon: IconName;
  color: Rgb;
  size?: number;
}): JSX.Element {
  return (
    <span
      data-testid="journey-domain-badge"
      data-icon={icon}
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: rgbCss(color, 0.18),
        border: `1px solid ${rgbCss(color, 0.45)}`,
        color: rgbCss(color),
      }}
    >
      <Icon name={icon} size={size >= 24 ? 16 : 14} />
    </span>
  );
}

/** One end: flag, name, code, and the country spelled out under it. */
export function JourneyEndLine({ end, locale }: { end: JourneyEnd; locale: string }): JSX.Element {
  const country = countryName(end.country, locale);
  return (
    <div className="text-[11px]">
      <div
        className="flex items-center gap-1.5 text-[12px] font-medium"
        style={{ color: tokens.color.text }}
      >
        {end.country && <FlagImg country={end.country} height={14} />}
        <span>{end.name}</span>
        {end.code && end.code !== end.name && (
          <span className="font-mono text-[10px]" style={{ color: tokens.color.faint }}>
            {end.code}
          </span>
        )}
      </div>
      {country && <div style={{ color: tokens.color.faint }}>{country}</div>}
    </div>
  );
}

/**
 * The operator's mark and name, as one metadata row. A logo from Commons is
 * credited right under it — licence and author, linked to the file page —
 * because a free licence is a licence, not a gift.
 */
export function OperatorRow({
  domain,
  name,
  color,
  t,
}: {
  /** A journey domain, or a cruise — whose card names its line the same way. */
  domain: JourneyDomain | "cruise";
  name: string;
  color: Rgb;
  t: TFn;
}): JSX.Element {
  const logo = useOperatorLogo(domain, name);
  const credit = logo?.credit ?? null;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span style={LABEL_STYLE}>{t(`map:journey.operator.${domain}`)}</span>
        <span className="flex items-center gap-2 text-right text-[11px]">
          <span>{name}</span>
          {domain !== "flight" && (
            <OperatorTile
              name={name}
              domain={domain}
              logoUrl={logo?.url ?? null}
              size={28}
              colour={rgbCss(color)}
            />
          )}
        </span>
      </div>
      {credit && (
        <a
          href={credit.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="operator-logo-credit"
          className="block text-right text-[9.5px] underline-offset-2 hover:underline"
          style={{ color: tokens.color.faint }}
        >
          {t("map:journey.attribution", {
            source: [credit.licence, credit.artist, "Wikimedia Commons"]
              .filter(Boolean)
              .join(" · "),
          })}
        </a>
      )}
    </>
  );
}

/** The page a journey is opened (and edited) on. */
export function journeyPath(j: Pick<MapJourney, "domain" | "id">): string {
  return `${DOMAINS[j.domain].routePrefix}/${j.id}`;
}

/** The facts of one journey that the domain recorded, as short strings. */
export function journeyFactText(j: MapJourney, t: TFn): string[] {
  const f = j.facts;
  const out: string[] = [];
  if (f.trainNumber) out.push(f.trainNumber);
  if (f.lineName) out.push(f.lineName);
  if (f.vesselName) out.push(f.vesselName);
  if (f.travelClass) out.push(t(`rail:class.${f.travelClass}`));
  if (f.cabinType) out.push(f.cabinType);
  if (f.vehicleClass) out.push(f.vehicleClass);
  return out;
}

const COLLAPSED = 2;

/**
 * The journeys on a route or at a station, newest first. Each row opens the
 * entry's own page — where it is edited too — so the card is the way INTO a
 * journey, as the flight card's "Flug öffnen" is.
 */
export function JourneyList({
  journeys,
  t,
}: {
  journeys: readonly MapJourney[];
  t: TFn;
}): JSX.Element | null {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  if (journeys.length === 0) return null;
  const shown = expanded ? journeys : journeys.slice(0, COLLAPSED);
  const more = journeys.length - COLLAPSED;
  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: tokens.color.border }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span style={LABEL_STYLE}>{t("map:journey.journeys")}</span>
        {more > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer text-[10px] font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
            style={{ color: tokens.color.accent }}
          >
            {expanded ? t("map:journey.listHide") : t("map:journey.listShow", { count: more })}
          </button>
        )}
      </div>
      <ul className="space-y-0.5 overflow-y-auto" style={{ maxHeight: expanded ? 160 : undefined }}>
        {shown.map((j) => (
          <li key={j.id}>
            <button
              type="button"
              data-testid="journey-row"
              onClick={() => navigate(journeyPath(j))}
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-left text-[11px] hover:bg-white/5 pointer-coarse:min-h-(--ts-size-touch-min)"
            >
              <span className="truncate font-medium">
                {[j.operator, ...journeyFactText(j, t)].filter(Boolean).join(" · ") || "—"}
              </span>
              {j.planned && (
                <span className="text-[10px]" style={{ color: tokens.color.faint }}>
                  {t("map:journey.planned")}
                </span>
              )}
              <span className="ml-auto shrink-0 tabular-nums opacity-55">{journeyDay(j)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
