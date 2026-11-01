import { useEffect, useRef, useState } from "react";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { ActionControl, ErrorLine, SettingItem } from "../ui/settings";
import { useBlockConfirm } from "./useBlockConfirm";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import HomePeriodEditor, { type HomeEditorMode } from "./HomePeriodEditor";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { settingsApi, type HomePeriod } from "../../lib/api";
import { apiErrorCode } from "../../lib/apiError";
import { formatLocalDate } from "../../lib/displayFormat";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
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

interface HomeAirportSectionProps {
  /**
   * `residence` is "Wohnort" under Profil & Anmeldung (the home and its moves);
   * `airports` is "Heimatflughäfen" under Flüge (the current home's airports).
   * Both read and write the same periods.
   */
  view?: "residence" | "airports";
}

export default function HomeAirportSection({
  view = "residence",
}: HomeAirportSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const coarse = useCoarsePointer();
  const { confirm: askConfirm, dialog: confirmDialog } = useBlockConfirm();
  const isDemo = useIsDemoAccount();
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
    if (code === "HOME_PERIOD_OVERLAP") return t("settings:homeAirport.errors.overlap");
    if (code === "HOME_AIRPORT_UNKNOWN") {
      const codes = (err as { response?: { data?: { codes?: string[] } } }).response?.data?.codes;
      return t("settings:homeAirport.errors.unknownAirport", { codes: (codes ?? []).join(", ") });
    }
    return t("settings:homeAirport.errors.saveFailed");
  };

  /** The ref a "move" carries: one per editor session, so a retry replays instead of doubling. */
  const moveRef = useRef<string>("");

  const run = async (call: () => Promise<{ periods: HomePeriod[] }>): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await call();
      setPeriods(saved.periods);
      addToast("success", t("settings:homeAirport.savedToast"));
      return true;
    } catch (err) {
      logger.error("Failed to save home periods:", err);
      const overlap = (err as { response?: { data?: { periods?: HomePeriod[] } } }).response?.data
        ?.periods;
      if (apiErrorCode(err) === "HOME_PERIOD_OVERLAP" && overlap) setPeriods(overlap);
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
    let ok: boolean;
    if (editing.mode === "new") {
      if (current && period.fromDate <= current.fromDate) {
        setSaveError(
          t("settings:homeAirport.errors.moveBeforeCurrent", {
            date: formatLocalDate(current.fromDate),
          })
        );
        return;
      }
      const residence = period.residence;
      if (!residence) {
        setSaveError(t("settings:homeAirport.errors.residenceMissing"));
        return;
      }
      ok = await run(() =>
        settingsApi.moveHome({
          fromDate: period.fromDate,
          residence,
          airports: period.airports,
          clientRef: moveRef.current,
        })
      );
    } else {
      const next = periods.map((p, i) => (i === editing.index ? period : p));
      ok = await run(() => settingsApi.saveHomePeriods(next));
    }
    if (ok) setEditing(null);
  };

  const handleDelete = async (index: number): Promise<void> => {
    const period = periods[index];
    const confirmed = await askConfirm({
      title: t("settings:homeAirport.deleteDialog.title"),
      affects: period?.residence?.name ?? t("settings:homeAirport.residenceUnknown"),
      amount: t("settings:homeAirport.deleteDialog.amount"),
      after: t("settings:homeAirport.deleteDialog.after"),
      confirmLabel: t("settings:homeAirport.deleteDialog.confirm"),
    });
    if (!confirmed) return;
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
    if (mode === "new") moveRef.current = crypto.randomUUID();
    setEditing({ mode, index });
  };

  // Touch sizing follows the pointer, not the width (forgejo#321): on an iPad
  // the 40 px buttons sat under the 44 px a finger needs.
  const touch = coarse ? { minHeight: "var(--ts-size-touch-min)" } : undefined;

  const rowControls = (index: number, period: HomePeriod): JSX.Element => (
    <>
      {!period.residenceConfirmed ? (
        <ActionControl
          label={t("settings:homeAirport.confirm")}
          onClick={() => open("confirm", index)}
        />
      ) : (
        <ActionControl label={t("settings:homeAirport.edit")} onClick={() => open("edit", index)} />
      )}
      <ActionControl
        label={t("common:buttons.delete")}
        danger
        busy={saving}
        onClick={() => void handleDelete(index)}
      />
    </>
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
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  const body = (): JSX.Element => {
    if (loading) return <p className="t-caption">{t("common:loading.default")}</p>;
    if (loadFailed)
      return (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
          {t("settings:homeAirport.loadError")}
        </p>
      );
    if (view === "airports")
      return (
        <SettingItem
          title={t("settings:homeAirport.airportsRow.name")}
          sub={t("settings:homeAirport.airportsRow.sub")}
          help={t("settings:homeAirport.airportsRow.help")}
          locked={locked}
          control={
            current ? (
              <>
                <AirportList period={current} />
                <ActionControl
                  label={t("settings:homeAirport.edit")}
                  onClick={() => open("edit", currentIndex)}
                />
              </>
            ) : (
              <ActionControl
                label={t("settings:homeAirport.setNow")}
                onClick={() => open("new", null)}
              />
            )
          }
        />
      );
    return (
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
              style={touch}
              onClick={() => open("confirm", firstUnconfirmed)}
            >
              {t("settings:homeAirport.confirm")}
            </button>
          </div>
        )}
        <SettingItem
          title={t("settings:homeAirport.residenceRow.name")}
          sub={t("settings:homeAirport.residenceRow.sub")}
          help={t("settings:homeAirport.residenceRow.help")}
          locked={locked}
          control={
            current ? (
              <>
                <span>
                  {periodTitle(current)} ·{" "}
                  {t("settings:homeAirport.since", { date: formatLocalDate(current.fromDate) })}
                </span>
                {rowControls(currentIndex, current)}
                <ActionControl
                  label={t("settings:homeAirport.iMoved")}
                  onClick={() => open("new", null)}
                />
              </>
            ) : (
              <ActionControl
                label={t("settings:homeAirport.setNow")}
                onClick={() => open("new", null)}
              />
            )
          }
        >
          {!current && <p className="t-caption">{t("settings:homeAirport.notSet")}</p>}
        </SettingItem>
        {past.length > 0 && (
          <SettingItem title={t("settings:homeAirport.historyLabel")} locked={locked}>
            <SettingRows>
              {past.map(({ period, index }) => (
                <SettingItem
                  key={`${period.fromDate}-${index}`}
                  title={periodTitle(period)}
                  sub={t("settings:homeAirport.range", {
                    from: formatLocalDate(period.fromDate),
                    to: period.toDate
                      ? formatLocalDate(period.toDate)
                      : t("settings:homeAirport.stillActive"),
                  })}
                  locked={locked}
                  control={
                    <>
                      <AirportList period={period} />
                      {rowControls(index, period)}
                    </>
                  }
                />
              ))}
            </SettingRows>
          </SettingItem>
        )}
      </>
    );
  };

  return (
    <SectionCard>
      <SettingRows>{body()}</SettingRows>
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
      {saveError && <ErrorLine>{saveError}</ErrorLine>}
      {confirmDialog}
    </SectionCard>
  );
}
