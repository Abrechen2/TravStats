import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useNavigate } from "react-router-dom";
import AppShell from "../ui/AppShell";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { useRailVisible } from "../../hooks/useRailVisible";
import { useRailImportAdapter } from "../import/adapters/railAdapter";
import { useRentalImportAdapter } from "../import/adapters/rentalAdapter";
import { useRentalVisible } from "../../hooks/useRentalVisible";
import { useBusVisible } from "../../hooks/useBusVisible";
import { BusFormModal } from "../bus/BusFormModal";
import { flightsApi } from "../../lib/api/flights";
import { getUpcoming, type UpcomingEntry } from "../../lib/api/upcoming";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import SimplifiedFlightFormV2 from "../SimplifiedFlightFormV2";
import SpecialFlightModal from "../SpecialFlightModal";
import { useCruiseImportAdapter } from "../import/adapters/cruiseAdapter";
import { MapNextUpCard } from "./MapNextUpCard";
import { DomainFilterButton } from "./tabs/DomainFilterButton";
import { AddDomainPicker, type AddableDomain } from "./AddDomainPicker";
import { isValidDomain } from "../../shared/domains";
import DomainImportPanel from "../import/DomainImportPanel";
import { useLodgingImportAdapter } from "../import/adapters/lodgingAdapter";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { PlaceFormModal } from "../places/PlaceFormModal";
import { QuickVisitHost } from "../places/QuickVisitHost";
import type { Flight, FlightInput } from "../../types";
import type { FlightSubmitOptions } from "../FlightForm/useFlightForm";
import type { ImportDocument } from "../import/documentHandoff";
import type { ParseDomain } from "../../lib/api/parse";

interface DashboardLayoutProps {
  children: ReactNode;
  counts: {
    flight: number;
    cruise: number;
    poi: number;
    lodging: number;
    roadtrip: number;
    rail: number;
  };
  /** What is still ahead per domain — see DomainTabStrip (B6). Whether it is
   * part of `counts` or beside it differs per domain; the strip says which. */
  scheduledCounts?: { flight?: number; cruise?: number; lodging?: number };
  /** Optional refetch hook called after a create-modal saves so the
   * outer page can refresh counts / per-tab data without a navigation. */
  onDataChanged?: () => void;
  /** True once the counts fetch has resolved. Gates the empty state so it
   * cannot flash during the initial load, when every count is still 0. */
  countsLoaded?: boolean;
}

export function DashboardLayout({
  children,
  counts,
  onDataChanged,
  countsLoaded = false,
}: DashboardLayoutProps): JSX.Element {
  // Ensures the dashboard namespace is loaded for children that use t("dashboard:...")
  const { t } = useTranslation(["dashboard", "flights"]);
  // `setTab` and `scheduledCounts` were the domain strip's alone and go unused
  // with it; both stay in the props/route API because the strip's own routes
  // (`/dashboard/:tab`) are untouched and still set the tab.
  const { tab } = useDashboardRoute();
  const navigate = useNavigate();
  const [addingDomain, setAddingDomainState] = useState<AddableDomain | null>(null);
  // A document one import dialog found to belong to another (D1): the target
  // dialog opens with it and reads it, so the user never drops it twice.
  const [handedOver, setHandedOver] = useState<ImportDocument | null>(null);
  const setAddingDomain = (domain: AddableDomain | null): void => {
    setHandedOver(null);
    setAddingDomainState(domain);
  };
  const openOtherImport = (domain: ParseDomain, document: ImportDocument): void => {
    // A package tour is imported on the trips page and a place document in
    // the place import; neither is in `openableImports`, so no dialog here
    // offers the jump.
    if (domain === "package" || domain === "place") return;
    setAddingDomainState(domain);
    setHandedOver(document);
  };
  const lodgingAdapter = useLodgingImportAdapter();
  const cruiseAdapter = useCruiseImportAdapter();
  const railAdapter = useRailImportAdapter();
  const rentalAdapter = useRentalImportAdapter();
  const rentalVisible = useRentalVisible();
  const busVisible = useBusVisible();
  const [showSpecialModal, setShowSpecialModal] = useState(false);
  const { isEnabled } = useEnabledDomains();
  const placesVisible = usePlacesVisible();
  const railVisible = useRailVisible();
  const { addToast } = useToastStore();
  // What is coming up, per domain. Fetched HERE rather than inside the strip so
  // it reloads with the same `onDataChanged` signal the counts do — adding a
  // flight must move this line, not leave it stale until the next full load.
  const [upcoming, setUpcoming] = useState<UpcomingEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getUpcoming()
      .then((entries) => {
        // The server answers by the user's domains alone; the rail beta
        // switch is the client's to apply (owner rule 2026-09-25).
        if (!cancelled)
          setUpcoming(
            entries.filter(
              (e) =>
                (e.domain !== "rail" || railVisible) && (e.domain !== "rental" || rentalVisible)
            )
          );
      })
      .catch((err: unknown) => logger.error("Failed to load the upcoming entries", err));
    return () => {
      cancelled = true;
    };
    // `counts` changes whenever the page refetches after a create — the cheapest
    // honest trigger for "something might now be sooner than what is shown".
  }, [counts, railVisible, rentalVisible]);

  // On a domain tab, that domain's next entry; on "Alle", the soonest of all —
  // including the trip, which belongs to no single tab. `upcoming` arrives
  // sorted, so "the soonest" is simply the first one. Moved here verbatim from
  // DomainTabStrip, which used to own both the choice and the rendering.
  //
  // `isValidDomain(tab)` narrows `tab` from `DashboardTab` to `DomainKey`
  // before the comparison: the two unions only partially overlap ("tour" and
  // "all" are tabs that are no domain, "trip" is an entry domain that is no
  // tab), so comparing them directly was only accidentally correct.
  const nextUp =
    tab === "all"
      ? upcoming[0]
      : isValidDomain(tab)
        ? upcoming.find((entry) => entry.domain === tab)
        : undefined;
  // Read once per render rather than per card, so the label and any future
  // sibling agree on "now".
  const nowMs = Date.now();

  // What sits BELOW "Als Nächstes" in the map's right column (the stats card)
  // has to start under it. Measured rather than hard-coded: the card grows a
  // line for a secondary and another for a trip name, so a fixed offset would
  // either overlap it or leave a gap, depending on the entry.
  const [domainFilterOpen, setDomainFilterOpen] = useState(false);
  const nextUpRef = useRef<HTMLDivElement | null>(null);
  const [chromeTop, setChromeTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!nextUp) {
      setChromeTop(null);
      return;
    }
    const el = nextUpRef.current;
    if (!el) return;
    const measure = (): void => setChromeTop(64 + el.offsetHeight + 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nextUp]);

  const enabledDomains = {
    flight: isEnabled("flight"),
    cruise: isEnabled("cruise"),
    poi: isEnabled("poi"),
    lodging: isEnabled("lodging"),
    roadtrip: isEnabled("roadtrip"),
    rail: isEnabled("rail"),
    rental: isEnabled("rental"),
    bus: isEnabled("bus"),
  };

  // What the "+" menu offers. One entry differs from `enabledDomains`, on
  // purpose: the tab strip DIMS a domain the user switched off (so they can
  // click through and turn it back on), whereas a menu entry that opens
  // nothing is a dead end. POI therefore follows the same combined rule the
  // strip's visibility does — instance flag AND user toggle — where the menu
  // used to offer "POI hinzufügen" on the user toggle alone, and then did
  // nothing with the click (#288).
  //
  // "tour" is offered wherever tours are visible at all: it is not a domain
  // with a toggle, and a tour that belongs to no trip has no other place it
  // could be started from. Behind the roadtrips beta key since 2026-09-24.
  const toursVisible = useToursVisible();
  const addableDomains = {
    ...enabledDomains,
    poi: placesVisible,
    rail: railVisible,
    rental: rentalVisible,
    bus: busVisible,
    tour: toursVisible,
  };

  // Where a document found in the wrong dialog may be sent (D1): only to an
  // import this menu itself would open.
  const openableImports = (["flight", "cruise", "lodging", "rail", "rental"] as const).filter(
    (d) => addableDomains[d]
  );

  // A truly empty account: nothing in any domain. Shown only after the counts
  // have loaded, and only on the "all" landing tab — a per-domain tab already
  // has its own empty copy and its own "+".
  const isEmpty =
    countsLoaded &&
    counts.flight === 0 &&
    counts.cruise === 0 &&
    counts.poi === 0 &&
    counts.lodging === 0 &&
    counts.roadtrip === 0 &&
    counts.rail === 0;

  // A tour and a roadtrip open a page, not a modal: both are an ordered list
  // of points, which is not a thing to type into a dialog over the map.
  const startAdding = (domain: AddableDomain): void => {
    if (domain === "tour") navigate("/tours");
    else if (domain === "roadtrip") navigate("/roadtrips");
    else setAddingDomain(domain);
  };

  const handleFlightCreate = async (
    flight: FlightInput,
    opts?: FlightSubmitOptions
  ): Promise<Flight> => {
    try {
      const created = await flightsApi.create(flight, opts);
      addToast("success", t("flights:table.toast.updated"));
      setAddingDomain(null);
      onDataChanged?.();
      // Flows back into the form's post-create trip assignment (#199).
      return created;
    } catch (error) {
      logger.error("Failed to add flight from dashboard:", error);
      throw error;
    }
  };

  return (
    <AppShell width="full" viewport className="flex flex-col">
      {/* The domain strip that used to sit here is hidden (owner, 2026-09-28):
          the six-row domain filter on the map now answers "what is on the
          map", which is what the strip's counts were mostly read for. Its
          "Als Nächstes" line moved with it, into the map's right column as
          `Dashboard.dc.html` draws it (Als Nächstes → Sichtbar → Legende).

          Nothing about the tab ROUTES changed: `/dashboard/:tab` still
          resolves and `useDashboardRoute` still sets `tab`, so a bookmark
          into a single-domain tab keeps working. What is gone is the only
          in-page way to REACH those tabs — see the handover note. */}
      {/* Modus / Filter moved into the in-map control panel (MapChromeSections)
          — the map is the control surface for those. The "+ hinzufügen"
          action is a separate floating overlay, top-right over the map: a
          single button everywhere, opening a domain picker on the "Alle"
          tab (several domains could apply) or going straight to that tab's
          own domain on a single-domain tab. */}
      <div
        style={
          {
            flex: 1,
            position: "relative",
            overflow: "hidden",
            // Read by GlobeStatsCard (and anything else that stacks under the
            // top of the map's right column).
            ...(chromeTop !== null ? { "--ts-map-chrome-top": `${chromeTop}px` } : {}),
          } as React.CSSProperties
        }
      >
        {children}
        {isEmpty && tab === "all" && (
          <DashboardEmptyState onAddFlight={() => setAddingDomain("flight")} />
        )}
        {/* Als Nächstes, at the top of the map's right column. `top: 64`
            clears the "+ hinzufügen" button above it, the same offset
            GlobeStatsCard uses for the same reason. z-30 puts it in the
            chrome band, below the domain filter (35) so an open filter panel
            is never covered by it. */}
        {nextUp && (
          <div ref={nextUpRef} style={{ position: "absolute", top: 64, right: 16, zIndex: 30 }}>
            <MapNextUpCard entry={nextUp} nowMs={nowMs} />
          </div>
        )}
        {/* On a single-domain view the filter is the ONLY way back — the tab
            strip that used to offer "Alle" is gone. "Alle" tabs keep their own
            instance inside the map (AllTab's `filterSlot`), where the tour
            count is real; here it is unknown and the tour row shows no number
            rather than a wrong 0.

            z-35 matches the slot's own level, so it clears AllTab's key for
            the same reason. */}
        {tab !== "all" && (
          <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 35 }}>
            <DomainFilterButton
              tourCount={null}
              open={domainFilterOpen}
              onOpenChange={setDomainFilterOpen}
            />
          </div>
        )}
        <div style={{ position: "absolute", top: 16, right: 16, zIndex: 30 }}>
          {tab === "all" ? (
            <AddDomainPicker enabled={addableDomains} onPick={startAdding} />
          ) : (
            // `isValidDomain` narrows `tab` to `DomainKey` — the actual set
            // this button knows how to handle — rather than a cast that
            // ASSERTS `tab` is one. A cast here was wrong the moment
            // `DashboardTab` grew a tab with no domain behind it ("Touren"):
            // `tab as AddableDomain` would still compile for that tab and
            // silently render a live-looking button with a missing i18n key
            // that opens nothing on click. This guard makes the SAME mistake
            // impossible for the next domain-less tab too, instead of only
            // excluding the one we happened to find.
            isValidDomain(tab) && (
              <button
                type="button"
                onClick={() => startAdding(tab)}
                className="cursor-pointer rounded-lg px-3 py-2 text-[13px] font-semibold shadow-lg transition-opacity hover:opacity-90"
                style={{ background: "rgb(240,169,71)", color: "#0d1117", border: "none" }}
              >
                + {t(`dashboard:controls.addPerTab.${tab}`)}
              </button>
            )
          )}
        </div>
      </div>

      {addingDomain === "flight" && (
        <SimplifiedFlightFormV2
          initialDocument={handedOver}
          onSubmit={handleFlightCreate}
          onCancel={() => setAddingDomain(null)}
          onPickSpecialFlight={() => {
            setAddingDomain(null);
            setShowSpecialModal(true);
          }}
        />
      )}
      <SpecialFlightModal
        isOpen={showSpecialModal}
        flight={null}
        onClose={() => setShowSpecialModal(false)}
        onSaved={() => {
          setShowSpecialModal(false);
          onDataChanged?.();
        }}
      />
      <DomainImportPanel
        open={addingDomain === "cruise"}
        onClose={() => setAddingDomain(null)}
        onItemsCreated={() => onDataChanged?.()}
        adapter={cruiseAdapter}
        initialDocument={addingDomain === "cruise" ? handedOver : null}
        onOpenOtherImport={openOtherImport}
        openableDomains={openableImports}
      />
      {/* Stays were missing from this menu entirely, although the tab strip
          right above it counts them — the menu had been hard-wired to flights
          back when flights were all there was. */}
      <DomainImportPanel
        open={addingDomain === "lodging"}
        onClose={() => setAddingDomain(null)}
        onItemsCreated={() => onDataChanged?.()}
        adapter={lodgingAdapter}
        initialDocument={addingDomain === "lodging" ? handedOver : null}
        onOpenOtherImport={openOtherImport}
        openableDomains={openableImports}
      />
      {/* This slot held a "not wired — domain is disabled until V2" comment
          long after the domain had shipped, so the menu offered "POI
          hinzufügen" and the click went nowhere (#288). */}
      {/* A ticket mail or PDF first, typing it in as the footer route — the
          same chooser cruises and stays open with. Only offered while rail
          is visible (beta switch + domain), as `addableDomains` says. */}
      <DomainImportPanel
        open={addingDomain === "rail"}
        onClose={() => setAddingDomain(null)}
        onItemsCreated={() => onDataChanged?.()}
        adapter={railAdapter}
        initialDocument={addingDomain === "rail" ? handedOver : null}
        onOpenOtherImport={openOtherImport}
        openableDomains={openableImports}
      />
      <DomainImportPanel
        open={addingDomain === "rental"}
        onClose={() => setAddingDomain(null)}
        onItemsCreated={() => onDataChanged?.()}
        adapter={rentalAdapter}
        initialDocument={addingDomain === "rental" ? handedOver : null}
        onOpenOtherImport={openOtherImport}
        openableDomains={openableImports}
      />
      {/* "Besuch erfassen" from a place pin's card (forgejo#231); the map
          reloads afterwards so the pin shows the visit. */}
      {placesVisible && <QuickVisitHost onSaved={() => onDataChanged?.()} />}
      {/* Bus has no import: the pick opens the ride form itself, as places do.
          The form's button stays disabled after a save, so closing is ours. */}
      {addingDomain === "bus" && (
        <BusFormModal
          journey={null}
          onClose={() => setAddingDomain(null)}
          onSaved={() => {
            setAddingDomain(null);
            onDataChanged?.();
          }}
        />
      )}
      {addingDomain === "poi" && (
        <PlaceFormModal
          place={null}
          onClose={() => setAddingDomain(null)}
          onSaved={() => {
            // Stay on the map. The places list navigates to the new place's
            // page after a save; from here the user was looking at the map
            // and wants to see the pin, not leave it.
            setAddingDomain(null);
            onDataChanged?.();
          }}
        />
      )}
    </AppShell>
  );
}
