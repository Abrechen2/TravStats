import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { flightsApi } from "../../lib/api/flights";
import { useToastStore } from "../../store/toastStore";
import { useDashboardChromeStore } from "../../store/dashboardChromeStore";
import { logger } from "../../lib/logger";
import NavigationBar from "../NavigationBar";
import SimplifiedFlightFormV2 from "../SimplifiedFlightFormV2";
import SpecialFlightModal from "../SpecialFlightModal";
import { CruiseAddChooser } from "../Cruise/CruiseAddChooser";
import { DomainTabStrip } from "./DomainTabStrip";
import type { FlightInput } from "../../types";
import type { FlightSubmitOptions } from "../FlightForm/useFlightForm";

type AddableDomain = "flight" | "cruise" | "poi";

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

  const handleAdd = (pickedDomain?: AddableDomain): void => {
    const target = pickedDomain ?? (tab === "all" ? null : (tab as AddableDomain));
    if (target === "flight" || target === "cruise" || target === "poi") {
      setAddingDomain(target);
    }
  };

  // The "+ hinzufügen" action now lives in the in-map control panel, which
  // is rendered several layers below this layout. It signals an add request
  // through the chrome store; open the matching modal here. Guarded by a
  // seen-tick ref so re-renders don't re-open the modal — only a genuine
  // new request (higher tick) fires.
  const addTick = useDashboardChromeStore((s) => s.addTick);
  const seenTickRef = useRef(addTick);
  useEffect(() => {
    if (addTick === seenTickRef.current) return;
    seenTickRef.current = addTick;
    handleAdd(useDashboardChromeStore.getState().addDomain ?? undefined);
    // handleAdd only reads `tab`, which is current at effect time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTick]);

  const handleFlightCreate = async (
    flight: FlightInput,
    opts?: FlightSubmitOptions
  ): Promise<void> => {
    try {
      await flightsApi.create(flight, opts);
      addToast("success", t("flights:table.toast.updated"));
      setAddingDomain(null);
      onDataChanged?.();
    } catch (error) {
      logger.error("Failed to add flight from dashboard:", error);
      throw error;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <NavigationBar />
      <DomainTabStrip active={tab} counts={counts} enabled={enabledDomains} onSelect={setTab} />
      {/* Modus / Filter / + hinzufügen moved into the in-map control panel
          (MapChromeSections) — the map is now the single control surface,
          so no toolbar sits between the tab strip and the map. */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>{children}</div>

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
        <CruiseAddChooser
          onClose={() => setAddingDomain(null)}
          onSaved={() => onDataChanged?.()}
        />
      )}
      {/* POI: deliberately not wired — domain is disabled until V2. */}
    </div>
  );
}
