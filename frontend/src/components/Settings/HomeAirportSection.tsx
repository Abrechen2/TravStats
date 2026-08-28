import { useEffect, useState } from "react";
import { FieldLabel, SectionCard, SectionTitle } from "./SettingsShared";
import AirportAutocomplete from "../AirportAutocomplete";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi, type HomeAirportEntry } from "../../lib/api";
import type { Airport } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function HomeAirportSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [history, setHistory] = useState<HomeAirportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAirport, setPickerAirport] = useState<Airport | null>(null);
  const [pickerFromDate, setPickerFromDate] = useState<string>(todayIso());

  useEffect(() => {
    let mounted = true;
    settingsApi
      .getHomeAirports()
      .then((res) => {
        if (mounted) setHistory(res.history);
      })
      .catch((err) => {
        logger.error("Failed to load home airport history:", err);
        addToast("error", t("settings:homeAirport.loadError"));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [addToast, t]);

  const current = history.find((e) => e.toDate === null);
  const past = history.filter((e) => e.toDate !== null).reverse();

  const handleSaveMove = async (): Promise<void> => {
    if (!pickerAirport?.iata) {
      addToast("warning", t("settings:homeAirport.pickAirportFirst"));
      return;
    }
    setSaving(true);
    try {
      const { history: updated } = await settingsApi.setHomeAirport({
        iata: pickerAirport.iata,
        fromDate: pickerFromDate,
      });
      setHistory(updated);
      setPickerOpen(false);
      setPickerAirport(null);
      addToast("success", t("settings:homeAirport.savedToast"));
    } catch (err) {
      logger.error("Failed to save home airport:", err);
      addToast("error", t("settings:homeAirport.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (index: number): Promise<void> => {
    if (!window.confirm(t("settings:homeAirport.confirmDelete"))) return;
    setSaving(true);
    try {
      const { history: updated } = await settingsApi.deleteHomeAirport(index);
      setHistory(updated);
    } catch (err) {
      logger.error("Failed to delete home airport entry:", err);
      addToast("error", t("settings:homeAirport.deleteError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:homeAirport.title")}
        description={t("settings:homeAirport.description")}
      />


      {loading ? (
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      ) : (
        <>
          {/* Current home airport */}
          <div>
            <label className="label">{t("settings:homeAirport.currentLabel")}</label>
            {current ? (
              <div className="flex items-center gap-3 p-3 rounded-sm border border-border">
                <span className="font-semibold text-lg">{current.iata}</span>
                <span className="text-sm text-(--text-muted)">
                  {t("settings:homeAirport.since", { date: current.fromDate })}
                </span>
                <div className="ml-auto">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setPickerOpen(true);
                      setPickerFromDate(todayIso());
                    }}
                  >
                    {t("settings:homeAirport.iMoved")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-sm border border-dashed border-border text-sm text-(--text-muted) flex items-center justify-between gap-3">
                <span>{t("settings:homeAirport.notSet")}</span>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setPickerOpen(true);
                    setPickerFromDate(todayIso());
                  }}
                >
                  {t("settings:homeAirport.setNow")}
                </button>
              </div>
            )}
          </div>

          {/* History */}
          {past.length > 0 && (
            <div>
              <FieldLabel help={t("settings:homeAirport.help.historyExplained")}>{t("settings:homeAirport.historyLabel")}</FieldLabel>
              <ul className="space-y-1">
                {past.map((entry) => {
                  const trueIndex = history.indexOf(entry);
                  return (
                    <li
                      key={`${entry.iata}-${entry.fromDate}`}
                      className="flex items-center gap-3 p-2 text-sm rounded-sm border border-border"
                    >
                      <span className="font-semibold">{entry.iata}</span>
                      <span className="text-(--text-muted)">
                        {entry.fromDate} → {entry.toDate ?? t("settings:homeAirport.stillActive")}
                      </span>
                      <button
                        type="button"
                        className="ml-auto text-xs text-red-600 hover:underline disabled:opacity-50"
                        onClick={() => void handleDelete(trueIndex)}
                        disabled={saving}
                      >
                        {t("common:buttons.delete")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Picker */}
          {pickerOpen && (
            <div className="p-4 rounded-sm border border-border space-y-3">
              <h4 className="font-semibold">
                {current
                  ? t("settings:homeAirport.newHomeHeading")
                  : t("settings:homeAirport.initialHomeHeading")}
              </h4>
              <div>
                <label className="label">{t("settings:homeAirport.airportField")}</label>
                <AirportAutocomplete
                  value={pickerAirport}
                  onChange={setPickerAirport}
                  label=""
                  placeholder={t("settings:homeAirport.airportPlaceholder")}
                />
              </div>
              <div>
                <label className="label">{t("settings:homeAirport.fromDateField")}</label>
                <input
                  type="date"
                  className="input"
                  value={pickerFromDate}
                  onChange={(e) => setPickerFromDate(e.target.value)}
                  max={todayIso()}
                />
                <p className="text-xs text-(--text-muted) mt-1">
                  {t("settings:homeAirport.fromDateHint")}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleSaveMove()}
                  disabled={saving || !pickerAirport?.iata}
                >
                  {saving ? t("common:buttons.saving") : t("common:buttons.save")}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setPickerOpen(false);
                    setPickerAirport(null);
                  }}
                  disabled={saving}
                >
                  {t("common:buttons.cancel")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
