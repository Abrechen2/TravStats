import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * `/track/imports` — Importe (TravTrack plan, phase 5, T5.2). A placeholder
 * until the view is built: the menu entry already exists, and an entry that
 * leads to a blank page would read as broken.
 */
export default function TrackImports(): JSX.Element {
  const { t } = useTranslation(["track"]);
  return (
    <section data-testid="track-imports" className="flex flex-col gap-1">
      <h2 className="t-card-title">{t("track:coming.importsTitle")}</h2>
      <p className="t-body">{t("track:coming.importsBody")}</p>
    </section>
  );
}
