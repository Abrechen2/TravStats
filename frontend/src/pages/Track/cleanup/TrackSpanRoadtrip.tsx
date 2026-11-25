import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import RoadtripFromTrackDialog from "../roadtrip/RoadtripFromTrackDialog";
import type { TrackSpan } from "../map/trackSpan";

/** "Als Roadtrip übernehmen" for the shown day or span of days (rc46 extras A). */
export default function TrackSpanRoadtrip({ span }: { span: TrackSpan }): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [open, setOpen] = useState(false);
  const days = { fromDay: span.fromDay, toDay: span.toDay };
  return (
    <>
      <button
        type="button"
        className="self-start underline"
        onClick={() => setOpen(true)}
        data-testid="track-span-roadtrip"
      >
        {t("track:roadtrip.open")}
      </button>
      {open && <RoadtripFromTrackDialog span={days} days={days} onClose={() => setOpen(false)} />}
    </>
  );
}
