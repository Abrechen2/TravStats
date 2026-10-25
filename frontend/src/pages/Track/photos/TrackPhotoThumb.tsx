import { useState } from "react";
import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  travTrackViewsApi,
  type PhotoWindow,
  type TravTrackPhoto,
} from "../../../lib/api/travtrackViews";
import { formatTime } from "../../../lib/displayFormat";

/**
 * One placed photo's thumbnail, streamed through the server's grant (the
 * list's own window). A thumbnail that does not load says so in place.
 */
export default function TrackPhotoThumb({
  photo,
  window,
  zone,
  size = 96,
}: {
  photo: TravTrackPhoto;
  window: PhotoWindow;
  zone: string;
  size?: number;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [broken, setBroken] = useState(false);
  const time = formatTime(Date.parse(photo.takenAt), { timeZone: zone });
  return (
    <figure className="flex flex-col gap-1" style={{ width: size, margin: 0 }}>
      {broken ? (
        <span
          className="t-caption flex items-center justify-center"
          style={{ width: size, height: size, borderRadius: 8, background: token("surface2") }}
        >
          {t("track:photos.thumbFailed")}
        </span>
      ) : (
        <img
          src={travTrackViewsApi.photoUrl(photo.assetId, window)}
          alt={t("track:photos.alt", { time })}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setBroken(true)}
          style={{ width: size, height: size, objectFit: "cover", borderRadius: 8 }}
        />
      )}
      <figcaption className="t-caption tabular-nums">{time}</figcaption>
    </figure>
  );
}
