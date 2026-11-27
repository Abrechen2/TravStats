import { Select } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanVehicle } from "../../../lib/api/travplan";
import { CAMPING_VEHICLES } from "../route/NightSuggestions";

/** Short stops on the way and their usual length in minutes; the traveller can change both. */
export const QUICK_STOPS = [
  { key: "shopping", minutes: 45 },
  { key: "fuel", minutes: 15 },
  { key: "meal", minutes: 60 },
  { key: "break", minutes: 20 },
  { key: "service", minutes: 30, camping: true },
] as const;
export type QuickStopKey = (typeof QUICK_STOPS)[number]["key"];

/** The stops that fit the vehicle: a dump station only for a camping vehicle. */
export function quickStopsFor(vehicle: PlanVehicle["kind"] | null) {
  const camping = vehicle !== null && CAMPING_VEHICLES.has(vehicle);
  return QUICK_STOPS.filter((s) => !("camping" in s) || camping);
}

/**
 * "+ Kurzer Halt": shopping, fuel, a meal, a break, and for a motorhome the dump station. It
 * opens the entry form prefilled, so the place and time can be added before anything is saved.
 */
export function QuickStop({
  vehicle,
  busy,
  onPick,
}: {
  vehicle: PlanVehicle["kind"] | null;
  busy: boolean;
  onPick: (title: string, minutes: number) => void;
}) {
  const { t } = useTranslation("travplan");
  return (
    <Select
      aria-label={t("days.quickStop")}
      value=""
      disabled={busy}
      onChange={(e) => {
        const stop = QUICK_STOPS.find((s) => s.key === e.target.value);
        if (stop) onPick(t("days.stop." + stop.key), stop.minutes);
      }}
      style={{ width: "13rem", flex: "none" }}
    >
      <option value="">{t("days.quickStopPrompt")}</option>
      {quickStopsFor(vehicle).map((s) => (
        <option key={s.key} value={s.key}>
          {t("days.stop." + s.key)}
        </option>
      ))}
    </Select>
  );
}
