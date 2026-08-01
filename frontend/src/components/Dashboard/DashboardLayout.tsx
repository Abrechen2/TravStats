import { useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { flightsApi } from "../../lib/api/flights";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import NavigationBar from "../NavigationBar";
import SimplifiedFlightFormV2 from "../SimplifiedFlightFormV2";
import SpecialFlightModal from "../SpecialFlightModal";
import { CruiseAddChooser } from "../Cruise/CruiseAddChooser";
import { DomainTabStrip } from "./DomainTabStrip";
import { AddDomainPicker, type AddableDomain } from "./AddDomainPicker";
import type { Flight, FlightInput } from "../../types";
import type { FlightSubmitOptions } from "../FlightForm/useFlightForm";

interface DashboardLayoutProps {
  children: ReactNode;
  counts: { flight: number; cruise: number; poi: number };
  /** Optional refetch hook called after a create-modal saves so the
   * outer page can refresh counts / per-tab data without a navigation. */
  onDataChanged?: () => void;
}

export function DashboardLayout({
  children,
  counts,
  onDataChanged,
}: DashboardLayoutProps): JSX.Element {
  // Ensures the dashboard namespace is loaded for children that use t("dashboard:...")
  const { t } = useTranslation(["dashboard", "flights"]);
  const { tab, setTab } = useDashboardRoute();
  const [addingDomain, setAddingDomain] = useState<AddableDomain | null>(null);
  const [showSpecialModal, setShowSpecialModal] = useState(false);
  const { isEnabled } = useEnabledDomains();
  const { addToast } = useToastStore();

  const enabledDomains = {
    flight: isEnabled("flight"),
    cruise: isEnabled("cruise"),
    poi: isEnabled("poi"),
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <NavigationBar />
      <DomainTabStrip active={tab} counts={counts} enabled={enabledDomains} onSelect={setTab} />
      {/* Modus / Filter moved into the in-map control panel (MapChromeSections)
          — the map is the control surface for those. The "+ hinzufügen"
          action is a separate floating overlay, top-right over the map: a
          single button everywhere, opening a domain picker on the "Alle"
          tab (several domains could apply) or going straight to that tab's
          own domain on a single-domain tab. */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {children}
        <div style={{ position: "absolute", top: 16, right: 16, zIndex: 30 }}>
          {tab === "all" ? (
            <AddDomainPicker enabled={enabledDomains} onPick={setAddingDomain} />
          ) : (
            <button
              type="button"
              onClick={() => setAddingDomain(tab as AddableDomain)}
              className="cursor-pointer rounded-lg px-3 py-2 text-[13px] font-semibold shadow-lg transition-opacity hover:opacity-90"
              style={{ background: "rgb(240,169,71)", color: "#0d1117", border: "none" }}
            >
              + {t(`dashboard:controls.addPerTab.${tab}`)}
            </button>
          )}
        </div>
      </div>

      {addingDomain === "flight" && (
        <SimplifiedFlightFormV2
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
      {addingDomain === "cruise" && (
        <CruiseAddChooser onClose={() => setAddingDomain(null)} onSaved={() => onDataChanged?.()} />
      )}
      {/* POI: deliberately not wired — domain is disabled until V2. */}
    </div>
  );
}
