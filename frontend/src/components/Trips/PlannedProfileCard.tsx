import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { openDataApi, type PlannedProfile } from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import ElevationProfileChart from "./ElevationProfileChart";

/**
 * The climb of a tour before it is walked: ground heights along the planned
 * line, from Open-Meteo (2026-09-24). Only where the instance allows open
 * data, and only while the tour has no recording — once it has one, the
 * recording is the truth and this card steps aside.
 *
 * `lineKey` changes whenever the planned line does (a leg added, moved or
 * routed), which is what asks for a new profile; an unchanged line is cached
 * on the server.
 */
export default function PlannedProfileCard({
  routeId,
  lineKey,
  accent,
}: {
  routeId: string;
  lineKey: string;
  accent: string;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["openData"]);
  const enabled = useSettingsStore((s) => s.openDataEnabled) === true;
  const [profile, setProfile] = useState<PlannedProfile | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    openDataApi
      .plannedProfile(routeId)
      .then((p) => !cancelled && setProfile(p))
      .catch((err: unknown) => logger.warn("Loading the planned elevation profile failed", err));
    return () => {
      cancelled = true;
    };
  }, [enabled, routeId, lineKey]);

  if (!enabled || !profile) return null;
  const nf0 = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const figures = [
    { label: t("openData:planned.distance"), value: `${nf.format(profile.distanceKm)} km` },
    profile.ascentM !== null && {
      label: t("openData:planned.ascent"),
      value: `↑ ${nf0.format(profile.ascentM)} m`,
    },
    profile.descentM !== null && {
      label: t("openData:planned.descent"),
      value: `↓ ${nf0.format(profile.descentM)} m`,
    },
  ].filter((f): f is { label: string; value: string } => Boolean(f));

  return (
    <section
      className="rounded-lg border border-dashed border-(--color-border) p-3"
      aria-label={t("openData:planned.title")}
    >
      <p className="t-label-mono mb-2 text-(--text-muted)">{t("openData:planned.title")}</p>
      <dl className="grid grid-cols-3 gap-3">
        {figures.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-(--text-muted)">{f.label}</dt>
            <dd className="t-stat-number">{f.value}</dd>
          </div>
        ))}
      </dl>
      <ElevationProfileChart points={profile.profile} accent={accent} dashed />
      <p className="t-caption mt-1 text-(--text-muted)">{t("openData:planned.note")}</p>
    </section>
  );
}
