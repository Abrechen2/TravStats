import type { JSX } from "react";
import { Link } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { isNotConfigured } from "./trackPhotos";
import type { PhotosState } from "./useTrackPhotos";

/** Settings → Dienste, where an Immich connection is made. */
export const IMMICH_SETTINGS_PATH = "/settings/services?section=externalServices";

/**
 * What the photo request answered, in words: loading, a failure as its own
 * kind (no Immich connected points to Settings), or that Immich held more
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
        {t(state.key)}{" "}
        {isNotConfigured(state.key) && (
          <Link to={IMMICH_SETTINGS_PATH}>{t("track:photos.connect")}</Link>
        )}
      </p>
    );
  }
  if (state.kind === "loaded" && state.truncated) {
    return (
      <p className="t-caption" role="status" style={{ color: token("warn") }}>
        {t("track:photos.truncated")}
      </p>
    );
  }
  return null;
}
