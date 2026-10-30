import { useEffect, useId, useState } from "react";
import { isActualRecordDone } from "../../shared/actualRecordDone";
import { tripsApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import type { PlanItem } from "../../lib/api/travplan";
import { logger } from "../../lib/logger";
import { Button, Field, Select } from "../../components/ui";
import { PlanActions } from "./planLayout";
const collections: Record<string, string> = {
  flight: "flights",
  hotel: "lodgingStays",
  rail: "railJourneys",
  bus: "busJourneys",
  ferry: "ferryJourneys",
  cruise: "cruises",
  rental: "rentalBookings",
};
export function ActualRecordPicker({
  tripId,
  item,
  onLink,
  busy,
}: {
  tripId: string;
  item: PlanItem;
  onLink: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation("travplan"),
    [rows, setRows] = useState<{ id: string; title: string }[]>([]),
    [selected, setSelected] = useState(""),
    selectId = useId();
  useEffect(() => {
    let live = true;
    tripsApi
      .getById(tripId)
      .then((data) => {
        const values = (data as unknown as Record<string, unknown>)[collections[item.kind]];
        if (!Array.isArray(values)) return;
        const options = values.flatMap((value: unknown) => {
          if (!value || typeof value !== "object") return [];
          const row = value as Record<string, unknown>;
          if (typeof row.id !== "string" || !isActualRecordDone(String(row.status))) return [];
          const label = String(
            row.flightNumber || row.title || row.name || row.bookingReference || row.id
          );
          return [{ id: row.id, title: label }];
        });
        if (live) {
          setRows(options);
          setSelected(options[0]?.id || "");
        }
      })
      .catch((cause: unknown) => logger.warn("Failed to load the trip's records", cause));
    return () => {
      live = false;
    };
  }, [tripId, item.kind]);
  if (!collections[item.kind] || !rows.length) return null;
  return (
    <PlanActions>
      <Field label={t("linkActual")} htmlFor={selectId}>
        <Select id={selectId} value={selected} onChange={(e) => setSelected(e.target.value)}>
          {rows.map((row) => (
            <option value={row.id} key={row.id}>
              {row.title}
            </option>
          ))}
        </Select>
      </Field>
      <Button disabled={busy || !selected} onClick={() => onLink(selected)}>
        {t("linkActual")}
      </Button>
    </PlanActions>
  );
}
