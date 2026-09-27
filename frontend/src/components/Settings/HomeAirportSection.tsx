import { useEffect, useState } from "react";
import { FieldLabel, SectionCard, SectionTitle } from "./SettingsShared";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import HomePeriodEditor, { type HomeEditorMode } from "./HomePeriodEditor";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi, type HomePeriod } from "../../lib/api";
import { apiErrorCode } from "../../lib/apiError";
import { formatLocalDate } from "../../lib/displayFormat";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { todayZoneNow } from "../../hooks/useTodayZone";
import { todayIn } from "../../shared/time";

/**
 * "Zuhause" — residence plus home airports, by date (owner decision
 * 2026-09-27). The section key stays `homeAirport` so every bookmark and the
 * inbox link (`/settings?section=homeAirport`) keep working.
 *
 * A period migrated from the old one-airport shape arrives unconfirmed: its
 * residence is the airport, and the server keeps measuring from there until
 * the user confirms it here. The inbox asks once; this is where it is answered.
 */

/** Today in the profile zone (ADR 0002 Q1) — the UTC day was yesterday's until morning east of UTC. */
function todayIso(): string {
  return todayIn(todayZoneNow());
}

type Editing = { mode: HomeEditorMode; index: number | null } | null;

/** The periods after a move: the running one closes the day the new one begins. */
export function applyMove(periods: HomePeriod[], next: HomePeriod): HomePeriod[] {
  const closed = periods.map((p) => (p.toDate === null ? { ...p, toDate: next.fromDate } : p));
  return [...closed, { ...next, toDate: null }].sort((a, b) =>
    a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : 0
  );
}

function AirportList({ period }: { period: HomePeriod }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <span style={{ fontFamily: "var(--ts-font-mono)" }}>
      {period.airports.map((a, i) => (
        <span key={a.code}>
          {i > 0 && " · "}
          <strong style={{ color: "var(--ts-text-bright)" }}>{a.code}</strong>
          {a.primary && period.airports.length > 1 && (
            <span className="t-caption"> ({t("settings:homeAirport.primaryBadge")})</span>
          )}
        </span>
      ))}
    </span>
  );
}

export default function HomeAirportSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { confirm: askConfirm, confirmDialog } = useConfirmDialog();
  const addToast = useToastStore((s) => s.addToast);

  const [periods, setPeriods] = useState<HomePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    settingsApi
      .getHomeAirports()
      .then((res) => {
        if (mounted) setPeriods(res.periods);
      })
      .catch((err) => {
        logger.error("Failed to load home periods:", err);
        if (mounted) setLoadFailed(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const currentIndex = periods.findIndex((p) => p.toDate === null);
  const current = currentIndex >= 0 ? periods[currentIndex] : null;
  const past = periods
    .map((period, index) => ({ period, index }))
    .filter(({ period }) => period.toDate !== null)
    .reverse();
  const firstUnconfirmed = periods.findIndex((p) => !p.residenceConfirmed);

  const errorText = (err: unknown): string => {
    const code = apiErrorCode(err);
    if (code === "HOME_PERIODS_INVALID") return t("settings:homeAirport.errors.invalid");
    if (code === "HOME_AIRPORT_UNKNOWN") {
      const codes = (err as { response?: { data?: { codes?: string[] } } }).response?.data?.codes;
      return t("settings:homeAirport.errors.unknownAirport", { codes: (codes ?? []).join(", ") });
    }
    return t("settings:homeAirport.errors.saveFailed");
  };

  const store = async (next: HomePeriod[]): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await settingsApi.saveHomePeriods(next);
      setPeriods(saved.periods);
      addToast("success", t("settings:homeAirport.savedToast"));
      return true;
    } catch (err) {
      logger.error("Failed to save home periods:", err);
      const text = errorText(err);
      setSaveError(text);
      addToast("error", text);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (period: HomePeriod): Promise<void> => {
    if (!editing) return;
    let next: HomePeriod[];
    if (editing.mode === "new") {
      if (current && period.fromDate <= current.fromDate) {
        setSaveError(
          t("settings:homeAirport.errors.moveBeforeCurrent", {
            date: formatLocalDate(current.fromDate),
          })
        );
        return;
      }
      next = applyMove(periods, period);
    } else {
      next = periods.map((p, i) => (i === editing.index ? period : p));
    }
    if (await store(next)) setEditing(null);
  };

  const handleDelete = async (index: number): Promise<void> => {
    if (
      !(await askConfirm({ message: t("settings:homeAirport.confirmDelete"), destructive: true }))
    )
      return;
    setSaving(true);
    try {
      const saved = await settingsApi.saveHomePeriods(periods.filter((_, i) => i !== index));
      setPeriods(saved.periods);
    } catch (err) {
      logger.error("Failed to delete home period:", err);
      addToast("error", t("settings:homeAirport.errors.deleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  const open = (mode: HomeEditorMode, index: number | null): void => {
    setSaveError(null);
    setEditing({ mode, index });
  };

  const rowControls = (index: number, period: HomePeriod): JSX.Element => (
    <div className="flex flex-wrap gap-2">
      {!period.residenceConfirmed ? (
        <button type="button" className="btn-primary" onClick={() => open("confirm", index)}>
          {t("settings:homeAirport.confirm")}
        </button>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => open("edit", index)}>
          {t("settings:homeAirport.edit")}
        </button>
      )}
      <button
        type="button"
        className="btn-secondary"
        style={{ color: "var(--ts-bad)" }}
        onClick={() => void handleDelete(index)}
        disabled={saving}
      >
        {t("common:buttons.delete")}
      </button>
    </div>
  );

  const periodTitle = (period: HomePeriod): JSX.Element => (
    <span>
      {period.residence?.name ?? t("settings:homeAirport.residenceUnknown")}
      {!period.residenceConfirmed && (
        <span className="t-caption" style={{ color: "var(--ts-warn, var(--ts-bad))" }}>
          {" "}
          · {t("settings:homeAirport.unconfirmedBadge")}
        </span>
      )}
    </span>
  );

  const editorInitial =
    editing === null ? null : editing.index === null ? current : (periods[editing.index] ?? null);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:homeAirport.title")}
        description={t("settings:homeAirport.description")}
      />

      {loading ? (
        <p className="t-caption">{t("common:loading.default")}</p>
      ) : loadFailed ? (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
          {t("settings:homeAirport.loadError")}
        </p>
      ) : (
        <>
          {firstUnconfirmed >= 0 && editing === null && (
            <div
              className="rounded-lg p-3 space-y-2"
              role="status"
              style={{ border: "1px solid var(--color-border)", background: "var(--bg-base)" }}
            >
              <div className="font-semibold">{t("settings:homeAirport.unconfirmedTitle")}</div>
              <p className="text-sm">{t("settings:homeAirport.unconfirmedBody")}</p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => open("confirm", firstUnconfirmed)}
              >
                {t("settings:homeAirport.confirm")}
              </button>
            </div>
          )}

          <SettingRows>
            {current ? (
              <SettingRow
                title={
                  <span>
                    {t("settings:homeAirport.currentLabel")}: {periodTitle(current)}
                  </span>
                }
                sub={
                  <span>
                    <AirportList period={current} /> ·{" "}
                    {t("settings:homeAirport.since", { date: formatLocalDate(current.fromDate) })}
                  </span>
                }
                control={
                  <div className="flex flex-wrap gap-2">
                    {rowControls(currentIndex, current)}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => open("new", null)}
                    >
                      {t("settings:homeAirport.iMoved")}
                    </button>
                  </div>
                }
              />
            ) : (
              <SettingRow
                title={t("settings:homeAirport.currentLabel")}
                sub={t("settings:homeAirport.notSet")}
                control={
                  <button type="button" className="btn-primary" onClick={() => open("new", null)}>
                    {t("settings:homeAirport.setNow")}
                  </button>
                }
              />
            )}

            {past.length > 0 && (
              <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
                <FieldLabel help={t("settings:homeAirport.help.historyExplained")}>
                  {t("settings:homeAirport.historyLabel")}
                </FieldLabel>
                <SettingRows>
                  {past.map(({ period, index }) => (
                    <SettingRow
                      key={`${period.fromDate}-${index}`}
                      title={periodTitle(period)}
                      sub={
                        <span>
                          <AirportList period={period} /> ·{" "}
                          {t("settings:homeAirport.range", {
                            from: formatLocalDate(period.fromDate),
                            to: period.toDate
                              ? formatLocalDate(period.toDate)
                              : t("settings:homeAirport.stillActive"),
                          })}
                        </span>
                      }
                      control={rowControls(index, period)}
                    />
                  ))}
                </SettingRows>
              </div>
            )}
          </SettingRows>

          {editing !== null && (
            <HomePeriodEditor
              key={`${editing.mode}-${editing.index ?? "new"}`}
              mode={editing.mode}
              initial={editorInitial}
              today={todayIso()}
              saving={saving}
              onSave={(period) => void handleSave(period)}
              onCancel={() => setEditing(null)}
            />
          )}
          {saveError && (
            <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
              {saveError}
            </p>
          )}
        </>
      )}
      {confirmDialog}
    </SectionCard>
  );
}
