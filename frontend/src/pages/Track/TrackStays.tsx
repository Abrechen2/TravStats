import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * `/track/stays` — Aufenthalte (TravTrack plan, phase 5, T5.3). A placeholder
 * until the view is built: the menu entry already exists, and an entry that
 * leads to a blank page would read as broken.
 */
export default function TrackStays(): JSX.Element {
  const { t } = useTranslation(["track"]);
  return (
    <section data-testid="track-stays" className="flex flex-col gap-1">
      <h2 className="t-card-title">{t("track:coming.staysTitle")}</h2>
      <p className="t-body">{t("track:coming.staysBody")}</p>
    </section>
  );
}
