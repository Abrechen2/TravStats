import { settingsApi } from "../lib/api";
import { useCapabilitiesEpochStore } from "./capabilitiesEpochStore";
import { useSettingsStore } from "./settingsStore";
import { useSuggestionSwitchesStore } from "./suggestionSwitchesStore";
import { SWITCH_PAYLOADS, type SwitchKey, type SwitchValue } from "./suggestionSwitchPayloads";

/**
 * Saves that REPORT: the request is awaited, the store takes the value only
 * once the server confirmed it, and a refusal is thrown to the caller.
 *
 * The optimistic setters in the stores answer a refusal with a toast and a
 * rollback — the user's choice vanishes. A settings row puts these behind its
 * write queue (`useSettingWrite`) instead: it keeps the choice, says it was not
 * saved, and offers "Erneut versuchen" / "Verwerfen" on that row.
 */
export async function saveSwitch<K extends SwitchKey>(
  key: K,
  value: SwitchValue<K>
): Promise<void> {
  const payload = (
    SWITCH_PAYLOADS[key] as (v: unknown) => Parameters<typeof settingsApi.update>[0]
  )(value);
  await settingsApi.update(payload);
  const store = useSuggestionSwitchesStore;
  store.setState({ [key]: value } as Partial<ReturnType<typeof store.getState>>);
  if (key === "railImportLocalTransit" || key === "railImportBus") {
    const group = key === "railImportBus" ? "bus" : "localTransit";
    const saves = store.getState().railImportSaves;
    store.setState({ railImportSaves: { ...saves, [group]: saves[group] + 1 } });
  }
  if (key === "travPlan") useCapabilitiesEpochStore.getState().bump("travPlan");
}

export async function saveBaseCurrency(baseCurrency: string): Promise<void> {
  await settingsApi.update({ baseCurrency });
  useSettingsStore.setState({ baseCurrency });
}

let domainChain: Promise<unknown> = Promise.resolve();

/**
 * One domain switched on or off. Every row writes the WHOLE list, so the saves
 * are chained and each builds on the last CONFIRMED list: two rows flipped in
 * the same second cannot overwrite each other, and a refused one leaves the
 * list the server holds.
 */
export function saveDomainEnabled(key: string, on: boolean): Promise<void> {
  const run = async (): Promise<void> => {
    const current = useSettingsStore.getState().enabledDomains;
    const next = on
      ? current.includes(key as (typeof current)[number])
        ? current
        : [...current, key as (typeof current)[number]]
      : current.filter((k) => k !== key);
    await settingsApi.update({ enabledDomains: next });
    useSettingsStore.setState({ enabledDomains: next });
  };
  const result = domainChain.then(run, run);
  domainChain = result.catch(() => undefined);
  return result;
}

export async function saveAutoCreateTrips(autoCreateTrips: boolean): Promise<void> {
  await settingsApi.update({ autoCreateTrips });
  useSettingsStore.setState({ autoCreateTrips });
}
