import { useState } from "react";
import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  travTrackViewsApi,
  type PhotoWindow,
  type TravTrackPhoto,
} from "../../../lib/api/travtrackViews";
import { formatTime } from "../../../lib/format";
import EnlargeButton from "../../../components/common/photoViewer/EnlargeButton";
import { usePhotoViewer } from "../../../components/common/photoViewer/usePhotoViewer";
import { sourceOf } from "../../../components/common/photoViewer/viewerPhoto";

/**
 * One placed photo's thumbnail, streamed through the server's grant (the
 * list's own window). A thumbnail that does not load says so in place.
 */
export default function TrackPhotoThumb({
  photo,
  window,
  zone,
  size = 96,
  all,
}: {
  photo: TravTrackPhoto;
  window: PhotoWindow;
  zone: string;
  size?: number;
  /** The photos the viewer steps through; defaults to this one alone. */
  all?: TravTrackPhoto[];
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [broken, setBroken] = useState(false);
  const viewer = usePhotoViewer();
  const time = formatTime(Date.parse(photo.takenAt), { timeZone: zone });
  return (
    <figure className="flex flex-col gap-1" style={{ width: size, margin: 0 }}>
      {viewer.viewer}
      {broken ? (
        <span
          className="t-caption flex items-center justify-center"
          style={{ width: size, height: size, borderRadius: 8, background: token("surface2") }}
        >
          {t("track:photos.thumbFailed")}
        </span>
      ) : (
        <EnlargeButton
          onOpen={() => {
            const list = all && all.length > 0 ? all : [photo];
            viewer.open(
              list.map((p) => ({
                id: `${p.provider ?? "immich"}:${p.assetId}`,
                url: travTrackViewsApi.photoUrl(p, window, "preview"),
                takenAt: p.takenAt,
                source: sourceOf(p.provider),
              })),
              Math.max(
                list.findIndex((p) => p.assetId === photo.assetId),
                0
              )
            );
          }}
        >
          <img
            src={travTrackViewsApi.photoUrl(photo, window)}
            alt={t("track:photos.alt", { time })}
            width={size}
            height={size}
            loading="lazy"
            onError={() => setBroken(true)}
            style={{ width: size, height: size, objectFit: "cover", borderRadius: 8 }}
          />
        </EnlargeButton>
      )}
      <figcaption className="t-caption tabular-nums">{time}</figcaption>
    </figure>
  );
}
