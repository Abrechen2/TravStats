import type { JSX } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import ModuleSection from "./ModuleSection";
import PurposeVisibilitySection from "./PurposeVisibilitySection";

/** "Was du festhältst": the travel types, and under them what each one hides (private/business). */
export default function DomainsSection(): JSX.Element {
  const enabledDomains = useSettingsStore((s) => s.enabledDomains);
  return (
    <div className="space-y-4">
      <ModuleSection />
      <PurposeVisibilitySection domains={enabledDomains} />
    </div>
  );
}
