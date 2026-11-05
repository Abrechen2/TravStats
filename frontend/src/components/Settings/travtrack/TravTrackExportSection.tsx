import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useTodayZone } from "../../../hooks/useTodayZone";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { logger } from "../../../lib/logger";
import { travTrackApi, type TravTrackSummary } from "../../../lib/api/travtrack";
import { todayIn } from "../../../shared/time/clock";
import TrackExportDialog from "../../../pages/Track/TrackExportDialog";
import { Field, Input } from "../../ui/Field";
import { SettingRows } from "../../ui/SettingRow";
import { ActionControl, ErrorLine, SettingItem } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import { RowFailure } from "../location/useRowAction";
import { useSpanCount, useSpanPreset } from "./useSpan";

const NS = "settings:tt.export";

/**
 * Settings → TravTrack → Export: a span (preset by `?from=&until=`, else the
 * whole history), what it holds and in which time zone, then the download
 * through the same dialog the map used (GPX or JSON, parts when the span is
 * over the server's cap). Reachable with TravTrack off while data is held.
 */
export default function TravTrackExportSection(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const caps = useTravTrackCapabilities();
  const zone = useTodayZone();
  const preset = useSpanPreset();
  const [summary, setSummary] = useState<TravTrackSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [from, setFrom] = useState(preset.from);
  const [until, setUntil] = useState(preset.until);
  const [open, setOpen] = useState(false);
  const shown = caps !== null && (caps.hasData || caps.enabled);

  const load = (): void => {
    travTrackApi
      .summary()
      .then((s) => {
        setSummary(s);
        setLoadFailed(false);
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack export: could not load", err);
        setLoadFailed(true);
      });
  };
  useEffect(() => {
    if (shown) load();
  }, [shown]);

  const today = todayIn(zone);
  const dayOf = (iso: string | null): string => (iso ? todayIn(zone, new Date(iso)) : today);
  // An untouched field means the whole history, as the map's dialog offered.
  const effectiveFrom = from || (summary ? dayOf(summary.firstAt) : "");
  const effectiveUntil = until || (summary ? dayOf(summary.lastAt) : "");
  const count = useSpanCount(effectiveFrom, effectiveUntil);
  const invalid = effectiveFrom !== "" && effectiveUntil !== "" && effectiveFrom > effectiveUntil;
  if (!shown) return null;

  const empty = summary !== null && summary.pointCount === 0;

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t(`${NS}.name`)}
          sub={t(`${NS}.sub`)}
          help={t(`${NS}.help`)}
          control={
            <ActionControl
              label={t(`${NS}.do`)}
              disabled={!summary || empty || invalid || effectiveFrom === ""}
              onClick={() => setOpen(true)}
            />
          }
        >
          <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
            <Field label={t(`${NS}.from`)} htmlFor="tt-export-from">
              <Input
                id="tt-export-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label={t(`${NS}.until`)} htmlFor="tt-export-until">
              <Input
                id="tt-export-until"
                type="date"
                value={effectiveUntil}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          </div>
          {loadFailed ? <RowFailure error={t(`${NS}.loadError`)} onRetry={load} /> : null}
          {invalid ? <ErrorLine>{t(`${NS}.invalidRange`)}</ErrorLine> : null}
          {empty ? (
            <p className="t-caption" style={{ margin: 0 }}>
              {t(`${NS}.empty`)}
            </p>
          ) : count.kind === "count" ? (
            <p className="t-caption" role="status" data-testid="export-count" style={{ margin: 0 }}>
              {t(`${NS}.count`, { count: count.count, zone })}
            </p>
          ) : count.kind === "failed" ? (
            <ErrorLine>{t(count.key)}</ErrorLine>
          ) : null}
        </SettingItem>
      </SettingRows>
      <TrackExportDialog
        open={open}
        onClose={() => setOpen(false)}
        fromDay={effectiveFrom}
        toDay={effectiveUntil}
      />
    </SectionCard>
  );
}
