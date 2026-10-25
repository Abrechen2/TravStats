import { useEffect, useState } from "react";
import {
  travTrackViewsApi,
  type PhotoWindow,
  type TravTrackPhoto,
} from "../../../lib/api/travtrackViews";
import { logger } from "../../../lib/logger";
import { photoFailureKey } from "./trackPhotos";

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
    travTrackViewsApi
      .photos({ from, to })
      .then((answer) => {
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
        logger.warn("TravTrack photos could not be loaded", err);
        if (live) setState({ kind: "failed", key: photoFailureKey(err) });
      });
    return () => {
      live = false;
    };
  }, [from, to, generation]);
  return state;
}
