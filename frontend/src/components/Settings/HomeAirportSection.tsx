import { useEffect, useState } from "react";
import { FieldLabel, SectionCard, SectionTitle } from "./SettingsShared";
import { SettingRow, SettingRows } from "../ui/SettingRow";
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
        <p className="t-caption">{t("common:loading.default")}</p>
      ) : (
        <>
          <SettingRows>
            {current ? (
              <SettingRow
                title={t("settings:homeAirport.currentLabel")}
                sub={
                  <span style={{ fontFamily: "var(--ts-font-mono)" }}>
                    <strong style={{ color: "var(--ts-text-bright)" }}>{current.iata}</strong> ·{" "}
                    {t("settings:homeAirport.since", { date: current.fromDate })}
                  </span>
                }
                control={
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
                }
              />
            ) : (
              <SettingRow
                title={t("settings:homeAirport.currentLabel")}
                sub={t("settings:homeAirport.notSet")}
                control={
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
                }
              />
            )}

            {past.length > 0 && (
              <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
                <FieldLabel help={t("settings:homeAirport.help.historyExplained")}>
                  {t("settings:homeAirport.historyLabel")}
                </FieldLabel>
                <SettingRows>
                  {past.map((entry) => {
                    const trueIndex = history.indexOf(entry);
                    return (
                      <SettingRow
                        key={`${entry.iata}-${entry.fromDate}`}
                        title={entry.iata}
                        sub={
                          <span style={{ fontFamily: "var(--ts-font-mono)" }}>
                            {entry.fromDate} →{" "}
                            {entry.toDate ?? t("settings:homeAirport.stillActive")}
                          </span>
                        }
                        control={
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ color: "var(--ts-bad)" }}
                            onClick={() => void handleDelete(trueIndex)}
                            disabled={saving}
                          >
                            {t("common:buttons.delete")}
                          </button>
                        }
                      />
                    );
                  })}
                </SettingRows>
              </div>
            )}
          </SettingRows>

          {/* Picker */}
          {pickerOpen && (
            <div className="space-y-3">
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
                <p className="t-caption mt-1">{t("settings:homeAirport.fromDateHint")}</p>
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
