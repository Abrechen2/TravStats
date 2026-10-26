import { useEffect, useState } from "react";
import {
  travTrackViewsApi,
  type PhotoWindow,
  type TravTrackPhoto,
} from "../../../lib/api/travtrackViews";
import { immichApi } from "../../../lib/api/immich";
import { logger } from "../../../lib/logger";
import { isNotConfigured, photoFailureKey } from "./trackPhotos";

const NOT_CONFIGURED = "track:photos.failure.notConfigured";

/**
 * Whether this account reaches an Immich, asked with every photo read (one
 * small GET, never cached: a connection saved in Settings must count the
 * moment the user comes back); null when the status read failed — then the
 * photo read itself answers, and "no connection" is never claimed unproven.
 * Asking first keeps the expected "not connected" out of the browser console:
 * a 409 is logged there as a failed request whatever the page does with it
 * (UAT beta.28).
 */
const immichAccess = (): Promise<boolean | null> =>
  immichApi.getSettings().then(
    (status) => status?.hasAccess === true,
    () => null
  );

export type PhotosState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      photos: TravTrackPhoto[];
      truncated: boolean;
      /** The window the list was asked for — the thumbnails' grant. */
      window: PhotoWindow;
    }
  | { kind: "failed"; key: string };

/**
 * The window's placed photos while `window` is set; a failure is reported as
 * its own kind. Read again when `generation` moves: after a deletion a photo
 * may have lost its place on the track, and must not stay on the map.
 */
export function useTrackPhotos(window: PhotoWindow | null, generation = 0): PhotosState {
  const [state, setState] = useState<PhotosState>({ kind: "idle" });
  const from = window?.from;
  const to = window?.to;
  useEffect(() => {
    if (!from || !to) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    immichAccess()
      .then((access) => {
        if (access === false) return null;
        return travTrackViewsApi.photos({ from, to });
      })
      .then((answer) => {
        if (answer === null) {
          if (live) setState({ kind: "failed", key: NOT_CONFIGURED });
          return;
        }
        if (live) {
          setState({
            kind: "loaded",
            photos: answer.photos,
            truncated: answer.truncated,
            window: { from, to },
          });
        }
      })
      .catch((err: unknown) => {
        const key = photoFailureKey(err);
        // Not connected is a state the panel explains, not a failure to log.
        if (!isNotConfigured(key)) logger.warn("TravTrack photos could not be loaded", err);
        if (live) setState({ kind: "failed", key });
      });
    return () => {
      live = false;
    };
  }, [from, to, generation]);
  return state;
}
