import type { JSX } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import ModuleSection from "./ModuleSection";
import PurposeVisibilitySection from "./PurposeVisibilitySection";
import PurposeCatalogueSection from "./PurposeCatalogueSection";

/**
 * "Was du festhältst": the travel types, under them what each one hides (private/business), and
 * the travel purposes (built-in and the user's own, "Reisezwecke").
 */
export default function DomainsSection(): JSX.Element {
  const enabledDomains = useSettingsStore((s) => s.enabledDomains);
  return (
    <div className="space-y-4">
      <ModuleSection />
      <PurposeVisibilitySection domains={enabledDomains} />
      <PurposeCatalogueSection />
    </div>
  );
}
