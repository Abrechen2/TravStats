// One legend for every layer of the trip map, each row also its toggle.
//
// Colours are read where the layers read them (the domain, place and recording
// colours), never repeated here — a swatch that disagrees with its line is the
// 2.4.0 bug. A row's swatch also says HOW the layer is drawn: a thin line is
// a connection between two known points, a thick cased line is a track that
// was actually recorded (the map draws the two the same way).

import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useDomainColors } from "../../hooks/useDomainColors";
import { usePlaceColorStore } from "../../store/placeColorStore";
import { resolvePlaceColor } from "../../lib/placeColor";
import { hexToRgb } from "../../lib/domainColor";
import type { DomainKey } from "../../shared/domains";
import { GROUP_STYLE, LAYER_GROUPS, type LayerGroup } from "./tripMapGroups";
import { TRIP_MAP_CHROME } from "./tripMapColors";
import { RECORDING_RGB } from "./recording/recordingLayers";
import { SHARED_ROUTE_RGB } from "./recording/sharedRouteLayers";

type Rgb = [number, number, number];

const DOMAIN_OF: Partial<Record<LayerGroup, DomainKey>> = {
  rail: "rail",
  bus: "bus",
  ferry: "ferry",
  rental: "rental",
  tours: "tour",
};

interface Props {
  /** The groups with something to show, in the order the legend lists them. */
  present: ReadonlySet<LayerGroup>;
  hidden: ReadonlySet<LayerGroup>;
  onToggle: (group: LayerGroup) => void;
  /** Colours of the layers `TripMap` resolves itself (flights, cruises, hotels, stops). */
  colors: Partial<Record<LayerGroup, Rgb>>;
  /** A group's label key where the group's default word does not fit what it holds. */
  labelKeys?: Partial<Record<LayerGroup, string>>;
}

function Swatch({
  rgb,
  style,
}: {
  rgb: Rgb;
  style: (typeof GROUP_STYLE)[LayerGroup];
}): JSX.Element {
  const color = `rgb(${rgb.join(" ")})`;
  if (style === "point") {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-full"
        style={{ background: color }}
      />
    );
  }
  if (style === "recorded") {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-1 w-6 rounded-full"
        style={{ background: color, boxShadow: "0 0 0 1.5px rgb(255 255 255 / 0.85)" }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-block h-0.5 w-6 rounded-full"
      style={{ background: color }}
    />
  );
}

export function TripMapLegend({
  present,
  hidden,
  onToggle,
  colors,
  labelKeys,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const coarse = useCoarsePointer();
  const { colorOf } = useDomainColors();
  const placeConfig = usePlaceColorStore((s) => s.config);
  const [open, setOpen] = useState(true);
  const rows = LAYER_GROUPS.filter((g) => present.has(g));
  if (rows.length === 0) return null;

  const colorFor = (group: LayerGroup): Rgb => {
    const own = colors[group];
    if (own) return own;
    if (group === "recording") return RECORDING_RGB;
    if (group === "shared") return SHARED_ROUTE_RGB;
    if (group === "places") return resolvePlaceColor({ visited: true }, placeConfig);
    const domain = DOMAIN_OF[group];
    // No colour source is a group nobody drew a layer for; the neutral chrome ink, never a guess.
    if (!domain)
      return [
        TRIP_MAP_CHROME.labelText[0],
        TRIP_MAP_CHROME.labelText[1],
        TRIP_MAP_CHROME.labelText[2],
      ];
    return hexToRgb(colorOf(domain));
  };
  const target = coarse ? "min-h-(--ts-size-touch-min)" : "min-h-7";

  return (
    <div
      data-testid="trip-map-legend"
      className="absolute top-3 left-3 z-10 max-w-[60%] rounded-lg text-xs"
      style={{
        background: "rgba(13,17,23,0.85)",
        backdropFilter: "blur(6px)",
        border: "1px solid var(--color-border)",
        color: "var(--text-muted)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 font-medium ${target}`}
      >
        {t("trips:detail.map.legend.title")}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ul className="px-1 pb-1">
          {rows.map((group) => {
            const off = hidden.has(group);
            return (
              <li key={group}>
                <button
                  type="button"
                  onClick={() => onToggle(group)}
                  role="switch"
                  aria-checked={!off}
                  className={`flex w-full items-center gap-2 rounded-md px-2 text-left ${target}`}
                  style={{ opacity: off ? 0.45 : 1 }}
                >
                  <Swatch rgb={colorFor(group)} style={GROUP_STYLE[group]} />
                  <span className={off ? "line-through" : ""}>
                    {t(labelKeys?.[group] ?? `trips:detail.map.legend.group.${group}`)}
                  </span>
                  <span className="ml-auto pl-2 opacity-70">
                    {t(`trips:detail.map.legend.style.${GROUP_STYLE[group]}`)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
