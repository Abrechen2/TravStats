import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import type { RangePickState } from "./useRangePick";

/** What a click on a long span is doing: reading the day, failed (and why), or hit no leg. */
export default function TrackRangePickStatus({
  state,
}: {
  state: RangePickState;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  if (state.kind === "loading")
    return (
      <p className="t-caption" role="status" data-testid="track-pick-loading">
        {t("track:legs.pickLoading")}
      </p>
    );
  if (state.kind === "failed")
    return (
      <p
        className="t-body"
        role="alert"
        data-testid="track-pick-failed"
        style={{ color: token("bad") }}
      >
        {t("track:legs.pickFailed", { reason: t(state.key) })}
      </p>
    );
  if (state.kind === "none")
    return (
      <p className="t-body" role="status" data-testid="track-pick-none">
        {t("track:legs.pickNone")}
      </p>
    );
  return null;
}
