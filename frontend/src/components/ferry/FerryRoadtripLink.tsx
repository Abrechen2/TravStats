import { useEffect, useState } from "react";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { ferryApi, type FerryRoadtripLeg } from "../../lib/api/ferry";
import type { FerryJourney } from "../../types/ferry";
export function FerryRoadtripLink({ ride, onSaved }: { ride: FerryJourney; onSaved: () => void }) {
  const { t } = useTranslation(["ferry"]);
  const [legs, setLegs] = useState<FerryRoadtripLeg[]>([]);
  const [selected, setSelected] = useState(ride.roadtripLegId ?? "");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void ferryApi
      .roadtripLegs()
      .then((items) => {
        if (live) setLegs(items);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await ferryApi.linkLeg(ride.id, selected || null);
      onSaved();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2">
      <h2>{t("ferry:roadtrip.title")}</h2>
      <p className="text-sm">{t("ferry:roadtrip.hint")}</p>
      {error && <p role="alert">{t("ferry:saveError")}</p>}
      <select
        aria-label={t("ferry:roadtrip.title")}
        className="rounded border bg-[var(--bg-surface)] p-2"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={busy}
      >
        <option value="">{t("ferry:roadtrip.none")}</option>
        {legs
          .filter(
            (leg) =>
              (!leg.ferryJourney || leg.ferryJourney.id === ride.id) &&
              (!ride.tripId || leg.route.tripId === ride.tripId)
          )
          .map((leg) => (
            <option key={leg.id} value={leg.id}>
              {leg.route.name}: {leg.fromStop.title} → {leg.toStop.title}
            </option>
          ))}
      </select>
      <Button
        disabled={busy || selected === (ride.roadtripLegId ?? "")}
        onClick={() => void save()}
      >
        {t("ferry:save")}
      </Button>
    </section>
  );
}
