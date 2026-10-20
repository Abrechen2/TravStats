import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  /** Fixes the server left out as GPS jitter; null when it could not check. */
  jitterDropped: number | null;
  /**
   * `track`: a stored recording, whose line AND distance leave the jitter out.
   * `line`: the trip recording, whose raw points stay stored — only the map
   * line leaves it out.
   */
  variant?: "track" | "line";
  className?: string;
}

/**
 * One line under a recording saying what the jitter filter did (forgejo#319):
 * how many fixes it left out, or that it could not check. Nothing when it
 * checked and found nothing — a clean recording needs no remark.
 */
export function JitterNote({
  jitterDropped,
  variant = "track",
  className = "t-caption",
}: Props): JSX.Element | null {
  const { t } = useTranslation("common");
  if (jitterDropped === 0) return null;
  const text =
    jitterDropped === null
      ? t("common:trackJitter.unchecked")
      : t(variant === "line" ? "common:trackJitter.droppedLine" : "common:trackJitter.dropped", {
          count: jitterDropped,
        });
  return (
    <p className={className} data-testid="track-jitter-note">
      {text}
    </p>
  );
}
