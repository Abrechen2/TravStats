/** Ferry crossings (dennis/TravStats forgejo#293). */
import { useBetaFeatures } from "./useBetaFeatures";
import { useEnabledDomains } from "./useEnabledDomains";

export function useFerryVisible(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  return isFeatureVisible("ferryDomain") && isEnabled("ferry");
}

export function useFerryOffered(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("ferryDomain");
}
