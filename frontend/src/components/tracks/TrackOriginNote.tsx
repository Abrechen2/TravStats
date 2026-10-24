import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { TrackOrigin, TrackOriginInfo } from "../../lib/api/trackOrigin";
import { token } from "../ui/tokens";

interface Props {
  info: TrackOriginInfo;
  /** Shows another source; absent where the view offers no switch. */
  onPick?: (source: TrackOrigin) => void;
}

const NS = "location:trackOrigin";

/**
 * Where a flight's or trip's line came from (TravTrack plan T5): "TravStats-
 * Aufzeichnung", "aus TravTrack" or "aus Dawarich"; a short or failed read
 * says so instead of passing for the whole; and only when another source holds
 * something, a switch to it — an extra view, never a silent swap.
 */
export default function TrackOriginNote({ info, onPick }: Props): JSX.Element | null {
  const { t } = useTranslation(["location"]);
  const { origin, coverage, alternatives } = info;
  if (!origin && alternatives.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="track-origin">
      {origin && <p className="t-caption">{t(`${NS}.label.${origin}`)}</p>}
      {(coverage === "truncated" || coverage === "unreachable") && (
        <p role="status" className="t-caption" style={{ color: token("warn") }}>
          {t(`${NS}.coverage.${coverage}`)}
        </p>
      )}
      {onPick && alternatives.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t(`${NS}.switch`)}
        >
          <span className="t-caption">{t(`${NS}.switch`)}</span>
          {alternatives.map((source) => (
            <button
              key={source}
              type="button"
              className="rounded-sm border border-(--color-border) px-2 py-1 text-xs hover:bg-(--bg-surface)"
              onClick={() => onPick(source)}
            >
              {t(`${NS}.show.${source}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
