import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Segmented } from "../ui/Segmented";
import type { TripsView } from "./useTripsView";

/** Tiles or list: a choice, so the shared segmented control (owner, 2026-11-22). */
export function TripsViewToggle({
  value,
  onChange,
}: {
  value: TripsView;
  onChange: (view: TripsView) => void;
}): JSX.Element {
  const { t } = useTranslation(["trips"]);
  return (
    <Segmented<TripsView>
      value={value}
      onChange={onChange}
      label={t("trips:view.label")}
      options={[
        { value: "tiles", label: t("trips:view.tiles") },
        { value: "list", label: t("trips:view.list") },
      ]}
    />
  );
}
