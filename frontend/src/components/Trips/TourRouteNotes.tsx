import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import DetailSection from "../ui/DetailSection";

/**
 * The free-text notes stored on a tour or roadtrip route. They arrive from
 * the API and the spreadsheet import; an empty or whitespace-only note draws
 * nothing, so the page never shows a titled box with nothing in it.
 */
export default function TourRouteNotes({ notes }: { notes: string | null }): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  if (notes === null || notes.trim() === "") return null;
  return (
    <DetailSection title={t("common:labels.notes")}>
      <p className="whitespace-pre-line text-sm" data-testid="tour-route-notes">
        {notes}
      </p>
    </DetailSection>
  );
}
