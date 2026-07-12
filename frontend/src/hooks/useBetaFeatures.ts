import { useCallback } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { type BetaFeatureKey, isBetaFeatureKey } from "../config/betaFeatures";

interface BetaFeaturesState {
  /**
   * The instance-level gate as reported by `GET /settings`. `null` = not
   * loaded yet (or the request failed) — treated as OFF.
   */
  betaFeaturesEnabled: boolean | null;
  /**
   * Whether a gated feature may be shown. Defaults to hidden whenever the
   * flag is unknown, so a feature can never flash into view during boot and
   * then disappear once the settings request lands.
   */
  isFeatureVisible: (key: BetaFeatureKey) => boolean;
}

/**
 * Reads the instance-level beta gate. See `config/betaFeatures.ts` for the
 * registry of what it hides and why.
 *
 * This controls VISIBILITY ONLY — the endpoints behind the gated features
 * stay open. Never use it as an authorisation check.
 */
export function useBetaFeatures(): BetaFeaturesState {
  const betaFeaturesEnabled = useSettingsStore((s) => s.betaFeaturesEnabled ?? null);

  const isFeatureVisible = useCallback(
    (key: BetaFeatureKey): boolean => {
      // Runtime guard as well as the compile-time one: an unknown key means
      // somebody gated a feature without registering it, and the registry is
      // the only place that records why a thing is hidden. Fail closed.
      if (!isBetaFeatureKey(key)) return false;
      return betaFeaturesEnabled === true;
    },
    [betaFeaturesEnabled]
  );

  return { betaFeaturesEnabled, isFeatureVisible };
}
