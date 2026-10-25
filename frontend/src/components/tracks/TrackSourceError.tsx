import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { TrackOrigin } from "../../lib/api/trackOrigin";

interface Props {
  /** The source that was asked for explicitly. */
  source: TrackOrigin;
  /** The answer's machine code, if it carried one. */
  code: string | null;
  /** Back to the default view. */
  onBack: () => void;
}

const NS = "location:trackOrigin";

/**
 * A source picked on request could not be shown (TravTrack plan T5, Codex
 * review): it holds nothing for the entry (404 TRACK_SOURCE_NOT_AVAILABLE) or
 * the read failed. Either way the way back stays on screen — a failed extra
 * view must never strand the reader without the line they came from.
 */
export default function TrackSourceError({ source, code, onBack }: Props): JSX.Element {
  const { t } = useTranslation(["location"]);
  return (
    <div className="flex flex-col items-start gap-2" data-testid="track-source-error">
      <p role="status" className="t-caption">
        {code === "TRACK_SOURCE_NOT_AVAILABLE"
          ? t(`${NS}.notAvailable.${source}`)
          : t(`${NS}.failed`)}
      </p>
      <button
        type="button"
        className="rounded-sm border border-(--color-border) px-2 py-1 text-xs hover:bg-(--bg-surface)"
        onClick={onBack}
      >
        {t(`${NS}.back`)}
      </button>
    </div>
  );
}
