import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Segmented } from "../ui/Segmented";

export type LodgingView = "houses" | "stays";

/** Houses or stays (forgejo#226): one logbook, two ways to read it — the shared segmented control. */
export function LodgingViewToggle({
  value,
  onChange,
}: {
  value: LodgingView;
  onChange: (view: LodgingView) => void;
}): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  return (
    <Segmented<LodgingView>
      value={value}
      onChange={onChange}
      label={t("lodging:stayView.toggle.label")}
      options={[
        { value: "houses", label: t("lodging:stayView.toggle.houses") },
        { value: "stays", label: t("lodging:stayView.toggle.stays") },
      ]}
    />
  );
}
