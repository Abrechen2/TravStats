import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { travTrackApi, type TravTrackSummary } from "../../../lib/api/travtrack";
import { todayIn } from "../../../shared/time/clock";
import { useTodayZone } from "../../../hooks/useTodayZone";
import TrackExportDialog from "../../../pages/Track/TrackExportDialog";
import { Field, Input } from "../../ui/Field";
import { SettingRows } from "../../ui/SettingRow";
import {
  ActionControl,
  ErrorLine,
  JumpControl,
  SettingItem,
  useGuardedNavigate,
} from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import TravTrackDiagnostics from "../TravTrackDiagnostics";
import TravTrackImports from "../TravTrackImports";
import { useBlockConfirm } from "../useBlockConfirm";
import DawarichCopyRow from "./DawarichCopyRow";
import { RowFailure, useRowAction } from "./useRowAction";

const NS = "settings:location.history";

/** The count that precedes a delete could not be read: nothing was deleted. */
class NotCounted extends Error {}

/**
 * Settings → Standort → Verlauf: copy the history in from Dawarich, read GPX
 * files (a jump to the imports; while that area is closed — TravTrack off with
 * data held — the import list stays here so a first file and every delete
 * remain reachable), export, delete days, and the diagnostics (expert).
 *
 * Deleting days is a danger row: the confirmation names the amount counted for
 * exactly that span, and says the days stay deleted for a phone that sends
 * them later.
 */
export default function TravTrackHistoryCard({
  summary,
  trackOpen,
  enabled,
  isDemo,
  expert,
  onChanged,
}: {
  summary: TravTrackSummary | null;
  /** The Track area is open: imports live there. */
  trackOpen: boolean;
  /** TravTrack is on for the instance. */
  enabled: boolean;
  isDemo: boolean;
  /** Expert rows are drawn. */
  expert: boolean;
  onChanged: () => Promise<void> | void;
}): JSX.Element {
  const { t } = useTranslation(["settings", "track"]);
  const navigate = useGuardedNavigate();
  const zone = useTodayZone();
  const { confirm, dialog } = useBlockConfirm();
  const [exporting, setExporting] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [importsVersion, setImportsVersion] = useState(0);
  const del = useRowAction((err) =>
    t(err instanceof NotCounted ? `${NS}.delete.notCounted` : `${NS}.delete.notDone`)
  );

  const today = todayIn(zone);
  const dayOf = (iso: string | null): string => (iso ? todayIn(zone, new Date(iso)) : today);
  const rangeInvalid = fromDay !== "" && toDay !== "" && fromDay > toDay;

  const deleteDays = async (): Promise<void> => {
    setNote(null);
    await del.run(async () => {
      const span = { fromDay, toDay };
      let count: number;
      try {
        count = (await travTrackApi.summary(span)).pointCount;
      } catch (err) {
        throw Object.assign(new NotCounted("count"), { cause: err });
      }
      const agreed = await confirm({
        title: t(`${NS}.delete.title`),
        affects: t(`${NS}.delete.affects`, { from: fromDay, to: toDay }),
        amount: t(`${NS}.delete.amount`, { count }),
        after: t(`${NS}.delete.after`),
        confirmLabel: t(`${NS}.delete.confirm`, { count }),
      });
      if (!agreed) return;
      const deleted = await travTrackApi.deleteDays(span);
      setNote(t(`${NS}.delete.done`, { count: deleted }));
      await onChanged();
    });
  };

  return (
    <SectionCard>
      <h3 className="t-heading-sm">{t(`${NS}.title`)}</h3>
      <SettingRows>
        <DawarichCopyRow
          canStart={enabled && !isDemo}
          onChanged={() => {
            setImportsVersion((v) => v + 1);
            void onChanged();
          }}
        />

        <SettingItem
          title={t(`${NS}.gpx.name`)}
          control={
            trackOpen ? (
              <JumpControl label={t(`${NS}.gpx.jump`)} onJump={() => navigate("/track/imports")} />
            ) : undefined
          }
        >
          {trackOpen ? null : (
            <TravTrackImports
              canImport={enabled && !isDemo}
              canDelete={!isDemo}
              version={importsVersion}
              onChanged={() => void onChanged()}
            />
          )}
        </SettingItem>

        {summary && summary.pointCount > 0 ? (
          <SettingItem
            title={t(`${NS}.export.name`)}
            sub={t(`${NS}.export.sub`)}
            control={
              <ActionControl label={t(`${NS}.export.label`)} onClick={() => setExporting(true)} />
            }
          />
        ) : null}

        {isDemo ? null : (
          <SettingItem
            title={t(`${NS}.delete.name`)}
            help={t(`${NS}.delete.help`)}
            control={
              <ActionControl
                danger
                label={t(`${NS}.delete.do`)}
                busy={del.busy}
                disabled={fromDay === "" || toDay === "" || rangeInvalid}
                onClick={() => void deleteDays()}
              />
            }
          >
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
            </div>
            {rangeInvalid ? <ErrorLine>{t(`${NS}.delete.invalidRange`)}</ErrorLine> : null}
            <RowFailure error={del.error} onRetry={del.retry} />
            {note ? (
              <p role="status" className="t-caption" style={{ margin: 0, color: "var(--ts-good)" }}>
                {note}
              </p>
            ) : null}
          </SettingItem>
        )}

        {expert ? (
          <SettingItem
            expert
            title={t(`${NS}.diag.name`)}
            sub={t(`${NS}.diag.sub`)}
            help={t(`${NS}.diag.help`)}
            control={
              <ActionControl
                label={t(diagOpen ? `${NS}.diag.close` : `${NS}.diag.open`)}
                onClick={() => setDiagOpen((open) => !open)}
              />
            }
          >
            {diagOpen ? <TravTrackDiagnostics today={today} canDelete={!isDemo} /> : null}
          </SettingItem>
        ) : null}
      </SettingRows>
      {summary ? (
        <TrackExportDialog
          open={exporting}
          onClose={() => setExporting(false)}
          fromDay={dayOf(summary.firstAt)}
          toDay={dayOf(summary.lastAt)}
        />
      ) : null}
      {dialog}
    </SectionCard>
  );
}
