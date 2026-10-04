// The appearance sections of the four overlay domains — day tours, roadtrips,
// rail and rentals (forgejo#198).
//
// The tester's report: the map panel offered widths and sizes for flights,
// cruises, lodging and places, and nothing at all for these four, whose widths
// were constants in their layer builders. Same layout as the neighbouring
// sections (a collapsible block per domain, `Slider`/`Toggle` from the kit),
// but the state is read from `store/overlayAppearanceStore.ts` directly rather
// than threaded down as props: these layers are built by the dashboard tabs,
// outside the map components, so the store is the one place both the slider
// and the layer can read (see `lib/overlayAppearance.ts`).
//
// Colour is not offered: these domains draw in their domain colour, which is
// set in Settings and already reaches the line and the legend together.

import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useRailVisible } from "../../hooks/useRailVisible";
import { useRentalVisible } from "../../hooks/useRentalVisible";
import { useToursVisible } from "../../hooks/useToursVisible";
import {
  OVERLAY_SIZE_RANGE,
  OVERLAY_WIDTH_RANGE,
  type OverlayAppearance,
} from "../../lib/overlayAppearance";
import { useOverlayAppearanceStore } from "../../store/overlayAppearanceStore";
import { CollapsibleSection, Slider, Toggle, type AppearanceDomain } from "./controlPanelKit";

type NumericKey = Exclude<keyof OverlayAppearance, "rentalShowLine">;

function WidthSlider({ field }: { field: NumericKey }): JSX.Element {
  const { t } = useTranslation();
  const value = useOverlayAppearanceStore((s) => s.appearance[field]);
  const setValue = useOverlayAppearanceStore((s) => s.setValue);
  return (
    <Slider
      label={t("map:globe.panel.width")}
      value={value}
      {...OVERLAY_WIDTH_RANGE}
      onChange={(v) => setValue(field, v)}
    />
  );
}

function SizeSlider({ field, label }: { field: NumericKey; label: string }): JSX.Element {
  const { t } = useTranslation();
  const value = useOverlayAppearanceStore((s) => s.appearance[field]);
  const setValue = useOverlayAppearanceStore((s) => s.setValue);
  return (
    <Slider
      label={label}
      value={value}
      {...OVERLAY_SIZE_RANGE}
      onChange={(v) => setValue(field, v)}
      format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
    />
  );
}

function RentalLineToggle(): JSX.Element {
  const { t } = useTranslation();
  const showLine = useOverlayAppearanceStore((s) => s.appearance.rentalShowLine);
  const setValue = useOverlayAppearanceStore((s) => s.setValue);
  return (
    <div className="-mx-1 mt-1.5">
      <Toggle
        checked={showLine}
        onChange={(v) => setValue("rentalShowLine", v)}
        icon="↔️"
        label={t("map:globe.panel.rentalShowLine")}
      />
      <div className="px-2 text-[10px] leading-snug" style={{ color: "rgba(241,245,249,0.45)" }}>
        {t("map:globe.panel.rentalShowLineHint")}
      </div>
      {/* The width of a line that is not drawn is not a control — hidden with it. */}
      {showLine && (
        <div className="px-1">
          <WidthSlider field="rentalLineWidth" />
        </div>
      )}
    </div>
  );
}

/**
 * Which overlay sections may show: the caller must name the domain (a section
 * only where that map draws it), AND the domain must be visible to this reader.
 * The second half is what keeps a beta domain out of the panel while its
 * switch is closed — the tab never draws it then, so a slider would be dead.
 */
function useShownOverlayDomains(domains: readonly AppearanceDomain[]): Set<AppearanceDomain> {
  const toursVisible = useToursVisible();
  const railVisible = useRailVisible();
  const rentalVisible = useRentalVisible();
  const { isEnabled } = useEnabledDomains();
  const allowed: Partial<Record<AppearanceDomain, boolean>> = {
    tour: toursVisible,
    roadtrip: isEnabled("roadtrip"),
    rail: railVisible,
    rental: rentalVisible,
  };
  return new Set(domains.filter((d) => allowed[d] === true));
}

/**
 * The tour, roadtrip, rail and rental sections, gated by `appearanceDomains`
 * exactly as the flight/cruise/lodging/place sections are. Rendered by both
 * the flat panel and the globe panel, so the two cannot drift.
 */
export function OverlayAppearanceSections({
  appearanceDomains,
}: {
  appearanceDomains: readonly AppearanceDomain[];
}): JSX.Element | null {
  const { t } = useTranslation();
  const shown = useShownOverlayDomains(appearanceDomains);
  if (shown.size === 0) return null;
  return (
    <>
      {shown.has("tour") && (
        <CollapsibleSection id="tour" title={t("map:globe.panel.domainTour")}>
          <WidthSlider field="tourLineWidth" />
        </CollapsibleSection>
      )}
      {shown.has("roadtrip") && (
        <CollapsibleSection id="roadtrip" title={t("map:globe.panel.domainRoadtrip")}>
          <WidthSlider field="roadtripLineWidth" />
          {appearanceDomains.includes("roadtripStations") && (
            <SizeSlider field="roadtripStationSize" label={t("map:globe.panel.stations")} />
          )}
        </CollapsibleSection>
      )}
      {shown.has("rail") && (
        <CollapsibleSection id="rail" title={t("map:globe.panel.domainRail")}>
          <WidthSlider field="railLineWidth" />
          <SizeSlider field="railStationSize" label={t("map:globe.panel.stations")} />
        </CollapsibleSection>
      )}
      {shown.has("rental") && (
        <CollapsibleSection id="rental" title={t("map:globe.panel.domainRental")}>
          <RentalLineToggle />
          <SizeSlider field="rentalMarkerSize" label={t("map:globe.panel.rentalStations")} />
        </CollapsibleSection>
      )}
    </>
  );
}
