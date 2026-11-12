import type { settingsApi } from "../lib/api";
import type { RailImportBus, RailImportLocalTransit } from "./suggestionSwitchesStore";

type Payload = Parameters<typeof settingsApi.update>[0];

/**
 * What each account switch of `suggestionSwitchesStore` sends to
 * `PUT /settings`. One table for both writers: the optimistic setters the rail
 * import still uses, and the confirmed save (`confirmedSettings.ts`) that the
 * settings rows put behind their write queue.
 */
export const SWITCH_PAYLOADS = {
  trips: (enabled: boolean): Payload => ({ tripSuggestions: { enabled } }),
  stays: (enabled: boolean): Payload => ({ staySuggestions: { enabled } }),
  stayImmichEvidence: (immichEvidence: boolean): Payload => ({
    staySuggestions: { immichEvidence },
  }),
  stayLlmPlaceClassification: (llmPlaceClassification: boolean): Payload => ({
    staySuggestions: { llmPlaceClassification },
  }),
  tripRecording: (enabled: boolean): Payload => ({ tripRecording: { enabled } }),
  tripDefaultColor: (color: string | null): Payload => ({ tripDefaults: { color } }),
  cruiseSeaDaysCounted: (counted: boolean): Payload => ({ cruiseSeaDays: { counted } }),
  liveTracking: (enabled: boolean): Payload => ({ liveTracking: { enabled } }),
  railImportLocalTransit: (localTransit: RailImportLocalTransit): Payload => ({
    railImport: { localTransit },
  }),
  railImportBus: (bus: RailImportBus): Payload => ({ railImport: { bus } }),
  travPlan: (enabled: boolean): Payload => ({ travPlan: { enabled } }),
  travPlanAi: (ai: boolean): Payload => ({ travPlan: { ai } }),
  travPlanWeather: (weather: boolean): Payload => ({ travPlan: { weather } }),
  displayCurrency: (displayCurrency: string): Payload => ({ displayCurrency }),
} as const;

export type SwitchKey = keyof typeof SWITCH_PAYLOADS;
export type SwitchValue<K extends SwitchKey> = Parameters<(typeof SWITCH_PAYLOADS)[K]>[0];
