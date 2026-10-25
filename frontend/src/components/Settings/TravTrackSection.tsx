import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { SectionCard, SectionTitle } from "./SettingsShared";
import DemoLockedNotice from "./DemoLockedNotice";
import Button from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTodayZone } from "../../hooks/useTodayZone";
import { useTravTrackCapabilities } from "../../hooks/useTravTrackVisible";
import { formatDateTime } from "../../lib/displayFormat";
import { parseCoordinateInput } from "../../lib/coordinateParse";
import { logger } from "../../lib/logger";
import { todayIn } from "../../shared/time/clock";
import {
  pointsInsideOf,
  trackErrorKey,
  travTrackApi,
  type PrivacyZone,
  type TravTrackSummary,
} from "../../lib/api/travtrack";
import TrackExportDialog from "../../pages/Track/TrackExportDialog";
import TravTrackImports from "./TravTrackImports";

/** The circles offered, metres: a flat to a small town (the server takes 50–5000). */
export const ZONE_RADII = [100, 250, 500, 1000, 2000] as const;

type Status = { tone: "ok" | "bad"; text: string } | null;

const NS = "track:settings";

/**
 * TravTrack in Settings → Standort (TravTrack plan T6; ported from the archived
 * `LocationHistorySection`, without the source switch and the transfer notes):
 * what is stored, export, the privacy zones, and delete by days. A new zone
 * over stored positions deletes them only after the count was named and
 * confirmed; a deleted span stays deleted.
 *
 * With TravTrack switched off an account holding data keeps all of it but the
 * zone add form — "TravTrack aus heißt: keine neue Erfassung, nichts wird
 * gelöscht, Export und Löschen bleiben möglich" (review focus 14).
 */
export default function TravTrackSection(): JSX.Element | null {
  const { t } = useTranslation(["track", "settings"]);
  const isDemo = useIsDemoAccount();
  const { isFeatureVisible } = useBetaFeatures();
  const caps = useTravTrackCapabilities();
  const zone = useTodayZone();
  const { confirm, confirmDelete, confirmDialog } = useConfirmDialog();
  const [summary, setSummary] = useState<TravTrackSummary | null>(null);
  const [zones, setZones] = useState<PrivacyZone[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [centre, setCentre] = useState("");
  const [radiusM, setRadiusM] = useState<number>(250);
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    try {
      const [s, z] = await Promise.all([travTrackApi.summary(), travTrackApi.zones()]);
      setSummary(s);
      setZones(z);
      setLoadFailed(false);
    } catch (err) {
      logger.warn("TravTrack settings: could not load", err);
      setLoadFailed(true);
    }
  }, []);

  const shown = caps !== null && (caps.hasData || caps.enabled);
  useEffect(() => {
    if (shown) void load();
  }, [shown, load]);

  if (!caps || !shown) return null;
  const canAddZones = caps.enabled && !isDemo;
  const trackOpen = isFeatureVisible("travTrack") && caps.enabled && (caps.active || caps.hasData);
  const today = todayIn(zone);
  const dayOf = (iso: string | null) => (iso ? todayIn(zone, new Date(iso)) : today);

  const point = parseCoordinateInput(centre);
  const canAdd = name.trim() !== "" && point !== null && !busy;

  const addZone = async () => {
    if (!point) return;
    setBusy(true);
    setStatus(null);
    const input = { name: name.trim(), lat: point.lat, lon: point.lon, radiusM };
    try {
      let result;
      try {
        result = await travTrackApi.createZone(input);
      } catch (err) {
        const inside = pointsInsideOf(err);
        if (inside === null) throw err;
        const agreed = await confirm({
          title: t(`${NS}.zones.confirmTitle`),
          message: t(`${NS}.zones.confirmMessage`, { count: inside }),
          confirmText: t(`${NS}.zones.confirmDo`),
          destructive: true,
        });
        if (!agreed) return;
        result = await travTrackApi.createZone({ ...input, deleteStoredPoints: true });
      }
      setName("");
      setCentre("");
      setStatus({
        tone: "ok",
        text:
          result.deleted > 0
            ? t(`${NS}.zones.addedDeleted`, { count: result.deleted })
            : t(`${NS}.zones.added`),
      });
      await load();
    } catch (err) {
      logger.warn("TravTrack settings: zone not saved", err);
      const key = trackErrorKey(err);
      setStatus({
        tone: "bad",
        text: t(key === "track:errors.generic" ? `${NS}.zones.notSaved` : key),
      });
    } finally {
      setBusy(false);
    }
  };

  const removeZone = async (z: PrivacyZone) => {
    if (!(await confirmDelete(t(`${NS}.zones.removeConfirm`, { name: z.name })))) return;
    setBusy(true);
    setStatus(null);
    try {
      await travTrackApi.deleteZone(z.id);
      await load();
    } catch (err) {
      logger.warn("TravTrack settings: zone not removed", err);
      setStatus({ tone: "bad", text: t(`${NS}.zones.notRemoved`) });
    } finally {
      setBusy(false);
    }
  };

  const deleteDays = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const span = { fromDay, toDay };
      const { pointCount } = await travTrackApi.summary(span);
      const agreed = await confirmDelete(
        t(`${NS}.delete.confirm`, { count: pointCount, from: fromDay, to: toDay })
      );
      if (!agreed) return;
      const deleted = await travTrackApi.deleteDays(span);
      setStatus({ tone: "ok", text: t(`${NS}.delete.done`, { count: deleted }) });
      await load();
    } catch (err) {
      logger.warn("TravTrack settings: days not deleted", err);
      setStatus({ tone: "bad", text: t(`${NS}.delete.notDone`) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle title={t("settings:travTrack.title")} />
      <p className="t-body" style={{ color: token("muted") }}>
        {t(`${NS}.intro`)}
      </p>
      {!caps.enabled && (
        <p className="t-body" role="status" data-testid="travtrack-off">
          {t(`${NS}.off`)}
        </p>
      )}

      {loadFailed ? (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(`${NS}.loadFailed`)}
        </p>
      ) : summary === null ? null : (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <p className="t-body" data-testid="travtrack-summary">
            {summary.pointCount === 0
              ? t(`${NS}.empty`)
              : t(`${NS}.summary`, {
                  count: summary.pointCount,
                  from: formatDateTime(summary.firstAt ?? ""),
                  to: formatDateTime(summary.lastAt ?? ""),
                  devices: summary.devices.length,
                })}
          </p>
          {trackOpen && <Link to="/track">{t(`${NS}.open`)}</Link>}
          {summary.pointCount > 0 && (
            <Button disabled={busy} onClick={() => setExporting(true)}>
              {t("track:actions.export")}
            </Button>
          )}
        </div>
      )}

      <TravTrackImports
        canImport={caps.enabled && !isDemo}
        canDelete={!isDemo}
        onChanged={() => void load()}
      />

      <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
        {t(`${NS}.zones.title`)}
      </h3>
      <p className="t-caption">{t(`${NS}.zones.intro`)}</p>
      {zones.length === 0 ? (
        <p className="t-body" style={{ color: token("muted") }}>
          {t(`${NS}.zones.none`)}
        </p>
      ) : (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {zones.map((z) => (
            <li
              key={z.id}
              className="flex items-center justify-between"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="t-body">
                {z.name} · {t(`${NS}.zones.radius`, { metres: z.radiusM })}
              </span>
              {!isDemo && (
                <Button disabled={busy} onClick={() => void removeZone(z)}>
                  {t(`${NS}.zones.remove`)}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isDemo ? (
        <DemoLockedNotice />
      ) : (
        <>
          {canAddZones && (
            <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
              <Field label={t(`${NS}.zones.name`)} htmlFor="travtrack-zone-name">
                <Input
                  id="travtrack-zone-name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t(`${NS}.zones.namePlaceholder`)}
                />
              </Field>
              <Field
                label={t(`${NS}.zones.centre`)}
                htmlFor="travtrack-zone-centre"
                hint={t(`${NS}.zones.centreHint`)}
                error={
                  centre.trim() !== "" && point === null
                    ? t(`${NS}.zones.centreInvalid`)
                    : undefined
                }
              >
                <Input
                  id="travtrack-zone-centre"
                  value={centre}
                  onChange={(e) => setCentre(e.target.value)}
                />
              </Field>
              <Field label={t(`${NS}.zones.radiusLabel`)} htmlFor="travtrack-zone-radius">
                <Select
                  id="travtrack-zone-radius"
                  value={String(radiusM)}
                  onChange={(e) => setRadiusM(Number(e.target.value))}
                >
                  {ZONE_RADII.map((metres) => (
                    <option key={metres} value={metres}>
                      {t(`${NS}.zones.radius`, { metres })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="primary" disabled={!canAdd} onClick={() => void addZone()}>
                {t(`${NS}.zones.add`)}
              </Button>
            </div>
          )}

          <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
            {t(`${NS}.delete.title`)}
          </h3>
          <p className="t-caption">{t(`${NS}.delete.intro`)}</p>
          <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
            <Field label={t(`${NS}.delete.from`)} htmlFor="travtrack-from-day">
              <Input
                id="travtrack-from-day"
                type="date"
                value={fromDay}
                onChange={(e) => setFromDay(e.target.value)}
              />
            </Field>
            <Field label={t(`${NS}.delete.to`)} htmlFor="travtrack-to-day">
              <Input
                id="travtrack-to-day"
                type="date"
                value={toDay}
                onChange={(e) => setToDay(e.target.value)}
              />
            </Field>
            <Button
              disabled={busy || fromDay === "" || toDay === "" || fromDay > toDay}
              onClick={() => void deleteDays()}
            >
              {t(`${NS}.delete.do`)}
            </Button>
          </div>
        </>
      )}

      {status && (
        <p
          className="t-body"
          role={status.tone === "bad" ? "alert" : "status"}
          style={{ color: token(status.tone === "bad" ? "bad" : "good") }}
        >
          {status.text}
        </p>
      )}
      {summary && (
        <TrackExportDialog
          open={exporting}
          onClose={() => setExporting(false)}
          fromDay={dayOf(summary.firstAt)}
          toDay={dayOf(summary.lastAt)}
        />
      )}
      {confirmDialog}
    </SectionCard>
  );
}
