import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { daySourcesApi, type DeletePreview } from "../../../lib/api/travtrackDaySources";
import { kindOfOrigin, sourceLabel } from "../../../pages/Track/trackDaySources";
import { ErrorLine } from "../../ui/settings";

/** Days listed at most; the count of the rest is said, not hidden. */
const SHOWN_DAYS = 10;

type State =
  | { kind: "loading" }
  | { kind: "loaded"; preview: DeletePreview }
  | { kind: "failed"; key: string };

/**
 * What a range delete takes, day by day and source by source, before the
 * confirmation: the server's own preview (`/travtrack/points/delete-preview`).
 * A failed read says so; the delete itself still asks for the typed word.
 */
export default function TravTrackDeleteBreakdown({
  from,
  until,
  version,
}: {
  from: string;
  until: string;
  version: number;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    daySourcesApi
      .deletePreview({ fromDay: from, toDay: until })
      .then((preview) => {
        if (live) setState({ kind: "loaded", preview });
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack delete preview by day failed", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [from, until, version]);
  if (state.kind === "loading") return null;
  if (state.kind === "failed") return <ErrorLine>{t(state.key)}</ErrorLine>;
  const { days } = state.preview;
  if (days.length === 0) return null;
  return (
    <div className="t-caption" data-testid="delete-breakdown">
      <p style={{ margin: 0 }}>{t("track:quality.previewDays", { count: days.length })}</p>
      <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
        {days.slice(0, SHOWN_DAYS).map((d) => (
          <li key={d.date}>
            {d.date}: {d.points} –{" "}
            {Object.entries(d.sources)
              .map(([src, n]) => `${sourceLabel(t, src, kindOfOrigin(src))} ${n}`)
              .join(", ")}
          </li>
        ))}
        {days.length > SHOWN_DAYS && <li>…</li>}
      </ul>
    </div>
  );
}
