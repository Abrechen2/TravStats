import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { flightsApi } from "../../../lib/api/flights";
import { railApi } from "../../../lib/api/rail";
import { busApi } from "../../../lib/api/bus";
import { cruiseApi } from "../../../lib/api/cruise";
import { getLodging } from "../../../lib/api/lodging";
import { getPlace } from "../../../lib/api/places";
import Button from "../../ui/Button";
import { W } from "./model";

const FlightForm = lazy(() => import("../../FlightEditModal"));
const RailForm = lazy(() =>
  import("../../rail/RailFormModal").then((m) => ({ default: m.RailFormModal }))
);
const BusForm = lazy(() =>
  import("../../bus/BusFormModal").then((m) => ({ default: m.BusFormModal }))
);
const CruiseForm = lazy(() =>
  import("../../Cruise/CruiseEditModal").then((m) => ({ default: m.CruiseEditModal }))
);
const LodgingForm = lazy(() =>
  import("../../lodging/LodgingFormModal").then((m) => ({ default: m.LodgingFormModal }))
);
const StayForm = lazy(() =>
  import("../../lodging/StayEditor").then((m) => ({ default: m.StayEditor }))
);
const PlaceForm = lazy(() =>
  import("../../places/PlaceFormModal").then((m) => ({ default: m.PlaceFormModal }))
);
const VisitForm = lazy(() =>
  import("../../places/VisitDialog").then((m) => ({ default: m.VisitDialog }))
);

type Editing =
  | { kind: "flight"; record: Awaited<ReturnType<typeof flightsApi.getById>> }
  | { kind: "rail"; record: Awaited<ReturnType<typeof railApi.get>> }
  | { kind: "bus"; record: Awaited<ReturnType<typeof busApi.get>> }
  | { kind: "cruise"; record: Awaited<ReturnType<typeof cruiseApi.get>> }
  | { kind: "lodging" | "stay"; record: Awaited<ReturnType<typeof getLodging>> }
  | { kind: "place" | "visit"; record: Awaited<ReturnType<typeof getPlace>> };

/** Reuse each domain's validated form, loading its current row only on demand. */
export default function RecordEditButton({
  entityType,
  entityId,
  parentId,
  label,
  disabled,
  onSaved,
}: {
  entityType: string;
  entityId: string;
  parentId?: string | null;
  label?: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation(["dataQuality", "common"]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [loading, setLoading] = useState(false);
  const lock = useRef(false);
  const [failed, setFailed] = useState(false);
  const supported =
    ["flight", "rail_journey", "bus_journey", "cruise", "lodging", "place"].includes(entityType) ||
    (["lodging_stay", "place_visit", "cruise_stop"].includes(entityType) && Boolean(parentId));
  if (!supported) return null;
  const open = async () => {
    if (lock.current || disabled) return;
    lock.current = true;
    setLoading(true);
    setFailed(false);
    try {
      switch (entityType) {
        case "flight":
          setEditing({ kind: "flight", record: await flightsApi.getById(entityId) });
          break;
        case "rail_journey":
          setEditing({ kind: "rail", record: await railApi.get(entityId) });
          break;
        case "bus_journey":
          setEditing({ kind: "bus", record: await busApi.get(entityId) });
          break;
        case "cruise":
        case "cruise_stop":
          setEditing({
            kind: "cruise",
            record: await cruiseApi.get(entityType === "cruise_stop" ? parentId! : entityId),
          });
          break;
        case "lodging":
        case "lodging_stay": {
          const record = await getLodging(entityType === "lodging" ? entityId : parentId!);
          if (entityType === "lodging_stay" && !record.stays.some((stay) => stay.id === entityId))
            throw new Error("Missing stay");
          setEditing({ kind: entityType === "lodging" ? "lodging" : "stay", record });
          break;
        }
        case "place":
        case "place_visit": {
          const record = await getPlace(entityType === "place" ? entityId : parentId!);
          if (entityType === "place_visit" && !record.visits.some((visit) => visit.id === entityId))
            throw new Error("Missing visit");
          setEditing({ kind: entityType === "place" ? "place" : "visit", record });
          break;
        }
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      lock.current = false;
    }
  };
  const close = () => setEditing(null);
  const saved = () => {
    close();
    onSaved();
  };
  const props = { onClose: close, onSaved: saved };
  return (
    <div>
      <Button disabled={disabled || loading} onClick={() => void open()}>
        {loading
          ? t("common:loading.default")
          : label
            ? t(`${W}.editNamed`, { name: label })
            : t(`${W}.editHere`)}
      </Button>
      {failed && (
        <p role="alert" className="mt-2 text-sm">
          {t(`${W}.recordLoadFailed`)}
        </p>
      )}
      {editing && (
        <Suspense fallback={<p role="status">{t("common:loading.default")}</p>}>
          {editing.kind === "flight" && (
            <FlightForm
              flight={editing.record}
              isOpen
              onClose={close}
              onSave={async (id, updates) => {
                await flightsApi.update(id, updates);
              }}
              onAfterSave={saved}
            />
          )}
          {editing.kind === "rail" && <RailForm journey={editing.record} {...props} />}
          {editing.kind === "bus" && <BusForm journey={editing.record} {...props} />}
          {editing.kind === "cruise" && (
            <CruiseForm cruise={editing.record} mode="edit" {...props} />
          )}
          {editing.kind === "lodging" && (
            <LodgingForm lodging={editing.record} mode="edit" {...props} />
          )}
          {editing.kind === "stay" && (
            <StayForm
              mode="edit"
              lodgingId={editing.record.id}
              lodgingName={editing.record.name}
              lodgingCountryCode={editing.record.isoCountryCode}
              lodgingChainId={editing.record.chainId}
              stay={editing.record.stays.find((s) => s.id === entityId)}
              {...props}
            />
          )}
          {editing.kind === "place" && <PlaceForm place={editing.record} {...props} />}
          {editing.kind === "visit" && (
            <VisitForm
              place={editing.record}
              visit={editing.record.visits.find((v) => v.id === entityId)}
              {...props}
            />
          )}
        </Suspense>
      )}
    </div>
  );
}
