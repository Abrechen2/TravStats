import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  EVIDENCE_THRESHOLDS,
  type EvidenceReason,
  type StopEvidenceView,
} from "../../lib/stopEvidenceView";
import { token } from "../ui/tokens";
import InfoLine from "../ui/InfoLine";

const LEVELS = ["low", "medium", "high"] as const;

/**
 * Where a suggested stop or place came from (a badge: the plugin and what it
 * called the place, the calendar event, or just the venue lookup) and how
 * sure the pipeline is (a three-step meter and a „Warum?" line naming the
 * evidence). A view without a confidence draws the badge only — never a meter
 * for a stop nothing could be weighed for.
 */
export default function StopEvidenceBadge({
  view,
}: {
  view: StopEvidenceView | null;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  if (!view) return null;
  const { source, confidence } = view;
  const number = { format: (n: number): string => String(Math.round(n)) };
  const badge =
    source.kind === "plugin"
      ? source.note
        ? `${source.note} · ${source.pluginName}`
        : source.pluginName
      : source.kind === "calendar"
        ? t("track:evidence.calendar", { title: source.title })
        : t("track:evidence.venue");
  const reason = (r: EvidenceReason): string => {
    switch (r.code) {
      case "venue":
        return t("track:evidence.why.venue", { m: number.format(r.distanceM) });
      case "dwell":
        return t("track:evidence.why.dwell", { min: number.format(r.minutes) });
      case "calendar":
        return t("track:evidence.why.calendar");
      case "plugin":
        return r.distanceM === null
          ? t("track:evidence.why.pluginNoDistance", { plugin: r.pluginName, name: r.name })
          : t("track:evidence.why.plugin", {
              plugin: r.pluginName,
              name: r.name,
              m: number.format(r.distanceM),
            });
    }
  };
  const step = confidence ? LEVELS.indexOf(confidence.level) + 1 : 0;
  return (
    <div className="flex flex-col gap-1" data-testid="stop-evidence">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="t-caption"
          data-testid="stop-evidence-source"
          data-kind={source.kind}
          style={{
            border: `1px solid ${token("border-button")}`,
            borderRadius: 999,
            padding: "1px 8px",
          }}
        >
          {badge}
        </span>
        {confidence && (
          <span
            role="meter"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={step}
            aria-label={t(`track:evidence.level.${confidence.level}`)}
            data-testid="stop-evidence-meter"
            data-level={confidence.level}
            className="flex items-center gap-1 t-caption"
          >
            <span aria-hidden className="flex gap-0.5">
              {LEVELS.map((l, i) => (
                <span
                  key={l}
                  style={{
                    width: 14,
                    height: 6,
                    borderRadius: 3,
                    background: i < step ? token("good") : token("border-button"),
                  }}
                />
              ))}
            </span>
            {t(`track:evidence.level.${confidence.level}`)}
          </span>
        )}
      </div>
      {confidence && (
        <p className="t-caption" data-testid="stop-evidence-why">
          {t("track:evidence.whyLabel")} {confidence.reasons.map(reason).join(", ")}
        </p>
      )}
      {confidence && (
        <InfoLine
          data-testid="stop-evidence-scale"
          text={t("track:evidence.scale", {
            highPoints: EVIDENCE_THRESHOLDS.highPoints,
            mediumPoints: EVIDENCE_THRESHOLDS.mediumPoints,
          })}
          more={t("track:evidence.scaleMore", {
            nearPluginM: EVIDENCE_THRESHOLDS.nearPluginM,
            farPluginM: EVIDENCE_THRESHOLDS.farPluginM,
            nearVenueM: EVIDENCE_THRESHOLDS.nearVenueM,
            closeVenueM: EVIDENCE_THRESHOLDS.closeVenueM,
            longDwellMin: EVIDENCE_THRESHOLDS.longDwellMin,
            highPoints: EVIDENCE_THRESHOLDS.highPoints,
            mediumPoints: EVIDENCE_THRESHOLDS.mediumPoints,
          })}
        />
      )}
    </div>
  );
}
