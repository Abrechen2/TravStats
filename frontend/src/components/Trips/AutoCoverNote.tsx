import { useState } from "react";
import type { JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";
import { useCoverCropStore } from "../../store/coverCropStore";
import CoverSuggestDialog from "./CoverSuggestDialog";

/**
 * A cover the server chose from the account's own photos says so, and offers the two
 * ways out: pick another (the suggestions) or re-frame it. A manual crop marks the
 * cover as the person's own, so the note goes away with it.
 */
export default function AutoCoverNote({
  trip,
  onChanged,
}: {
  trip: Pick<Trip, "id" | "coverImageUrl" | "coverCrop">;
  onChanged: () => void;
}): JSX.Element | null {
  const { t } = useTranslation("immich");
  const isSharedDemo = useIsDemoAccount();
  const [open, setOpen] = useState(false);
  if (isSharedDemo || !trip.coverImageUrl) return null;
  const link = {
    minHeight: "var(--ts-size-touch-min)",
    color: "var(--ts-muted)",
    background: "none",
    border: "none",
    padding: 0,
  } as const;
  return (
    <div
      className="t-caption flex flex-wrap items-center"
      style={{ gap: "var(--ts-space-sm)", color: "var(--ts-muted)" }}
      data-testid="auto-cover-note"
    >
      <span>{t("autoCover.note")}</span>
      <button type="button" className="underline" style={link} onClick={() => setOpen(true)}>
        {t("autoCover.other")}
      </button>
      <button
        type="button"
        className="underline"
        style={link}
        onClick={() =>
          useCoverCropStore.getState().open({
            tripId: trip.id,
            coverImageUrl: trip.coverImageUrl!,
            initialCrop: trip.coverCrop ?? null,
            onDone: onChanged,
          })
        }
      >
        {t("autoCover.adjust")}
      </button>
      {open && (
        <CoverSuggestDialog tripId={trip.id} onClose={() => setOpen(false)} onChosen={onChanged} />
      )}
    </div>
  );
}
