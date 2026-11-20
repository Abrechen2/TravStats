import type { JSX } from "react";
import { Link } from "react-router-dom";
import type { TrackPhotoProvider } from "../../../lib/api/travtrackViews";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { isNotConfigured } from "./trackPhotos";
import type { PhotosState } from "./useTrackPhotos";

/** Settings → Dienste, where a photo source (Immich, PhotoPrism) is connected. */
export const PHOTO_SETTINGS_PATH = "/settings/dienstek#immich";

/** The product names are not translated. */
const sourceName = (provider?: TrackPhotoProvider): string =>
  provider === "photoprism" ? "PhotoPrism" : "Immich";

/**
 * What the photo request answered, in words: loading, a failure as its own
 * kind naming its source (no source connected points to Settings), a source
 * that failed while the others' photos show, or that a library held more
 * photos than one request lists. Nothing while all is well.
 */
export default function TrackPhotoNotice({ state }: { state: PhotosState }): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  if (state.kind === "loading") {
    return <p className="t-caption">{t("track:photos.loading")}</p>;
  }
  if (state.kind === "failed") {
    return (
      <p className="t-caption" role="status" style={{ color: token("warn") }}>
        {t(state.key, { source: sourceName(state.provider) })}{" "}
        {isNotConfigured(state.key) && (
          <Link to={PHOTO_SETTINGS_PATH}>{t("track:photos.connect")}</Link>
        )}
      </p>
    );
  }
  if (state.kind !== "loaded") return null;
  return (
    <>
      {state.failures.map((f) => (
        <p
          key={f.provider}
          className="t-caption"
          role="status"
          data-testid={`track-photos-failure-${f.provider}`}
          style={{ color: token("warn") }}
        >
          {t(f.key, { source: sourceName(f.provider) })}
        </p>
      ))}
      {state.truncated && (
        <p className="t-caption" role="status" style={{ color: token("warn") }}>
          {t("track:photos.truncated")}
        </p>
      )}
    </>
  );
}
