import { useState } from "react";
import type { JSX } from "react";

import { Field, Select } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import { vehicleChoices } from "../../lib/roadtrip/roadtripView";
import type { RoadtripVehicle } from "../../shared/tour/roadtrip";
import type { TourRoute } from "../../types/tour";

/**
 * The planned vehicle (car, motorhome, …) of an existing roadtrip. It was
 * only choosable while creating; changing it later is the same
 * `PATCH /tours/:id/kind` the review notice uses. A refused change leaves the
 * select on the stored value and says why.
 */
export default function RoadtripVehicleSelect({
  route,
  onSaved,
}: {
  route: TourRoute;
  onSaved: (route: TourRoute) => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const current = route.vehicle ?? "";

  const change = async (next: string): Promise<void> => {
    if (next === "" || next === current) return;
    setBusy(true);
    setErrorKey(null);
    try {
      onSaved(
        await roadtripsApi.switchKind(route.id, {
          kind: "roadtrip",
          vehicle: next as RoadtripVehicle,
        })
      );
    } catch (err) {
      logger.warn("Changing a roadtrip's vehicle failed", err);
      setErrorKey(saveErrorKey(err, "roadtrips:vehicleChangeError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field
      label={t("roadtrips:newDialog.vehicle")}
      htmlFor="roadtrip-vehicle"
      error={errorKey ? t(errorKey) : undefined}
    >
      <Select
        id="roadtrip-vehicle"
        value={current}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
      >
        {current === "" && <option value="">{t("roadtrips:vehicleNone")}</option>}
        {vehicleChoices(route.vehicle).map((v) => (
          <option key={v} value={v}>
            {t(`roadtrips:vehicle.${v}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
