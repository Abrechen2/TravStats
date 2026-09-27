import { useProfileZoneStore, todayZoneFrom } from "../store/profileZoneStore";
import { useSettingsStore } from "../store/settingsStore";

/**
 * The zone "today" is answered in (ADR 0002 Q1): the confirmed profile zone,
 * else UTC — never the browser's. A form that defaults its date to "today"
 * asks `todayIn(useTodayZone())`, so a traveller whose laptop is still on
 * home time gets the day their profile says, and so does every other device.
 */
export function useTodayZone(): string {
  const status = useProfileZoneStore((s) => s.status);
  const zone = useSettingsStore((s) => s.display?.timezone);
  return todayZoneFrom(status, zone);
}

/**
 * The same answer outside React (event handlers, plain helpers). `getState`
 * is optional-called because many tests mock the stores as bare hooks —
 * the same guard `currentDisplayFormat` carries.
 */
export function todayZoneNow(): string {
  return todayZoneFrom(
    useProfileZoneStore.getState?.().status ?? "unknown",
    useSettingsStore.getState?.().display?.timezone
  );
}
