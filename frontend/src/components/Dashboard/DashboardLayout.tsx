import { useState } from "react";
import type { JSX, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import NavigationBar from "../NavigationBar";
import { DomainTabStrip } from "./DomainTabStrip";
import { DashboardControlsBar } from "./DashboardControlsBar";
import { DashboardFilterDropdown } from "./DashboardFilterDropdown";

interface DashboardLayoutProps {
  children: ReactNode;
  counts: { flight: number; cruise: number; poi: number };
}

export function DashboardLayout({ children, counts }: DashboardLayoutProps): JSX.Element {
  // Ensures the dashboard namespace is loaded for children that use t("dashboard:...")
  useTranslation(["dashboard"]);
  const { tab, mode, setTab, setMode } = useDashboardRoute();
  const [filterOpen, setFilterOpen] = useState(false);
  const { isEnabled } = useEnabledDomains();
  const navigate = useNavigate();

  const enabledDomains = {
    flight: isEnabled("flight"),
    cruise: isEnabled("cruise"),
    poi: isEnabled("poi"),
  };

  const handleAdd = (pickedDomain?: "flight" | "cruise" | "poi"): void => {
    const target =
      pickedDomain ?? (tab === "all" ? undefined : (tab as "flight" | "cruise" | "poi"));
    if (target === "flight") navigate("/flights?add=1");
    else if (target === "cruise") navigate("/cruises?add=1");
    else if (target === "poi") navigate("/poi?add=1");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <NavigationBar />
      <DomainTabStrip active={tab} counts={counts} enabled={enabledDomains} onSelect={setTab} />
      <DashboardControlsBar
        tab={tab}
        mode={mode}
        enabledDomains={enabledDomains}
        onModeChange={setMode}
        onFilterOpen={() => setFilterOpen((p) => !p)}
        onAdd={handleAdd}
      />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {children}
        <DashboardFilterDropdown tab={tab} open={filterOpen} onClose={() => setFilterOpen(false)} />
      </div>
    </div>
  );
}
