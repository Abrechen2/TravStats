import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import Button from "../../ui/Button";
import { Switch } from "../../ui/Field";
import { SettingRows } from "../../ui/SettingRow";
import { ConfirmDialog, SettingItem } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import {
  calendarFailureKey,
  calendarRequestFailureKey,
  calendarSourcesApi,
  type CalendarSource,
  type CalendarSourceList,
} from "../../../lib/api/calendarSources";
import CalendarSourceForm from "./CalendarSourceForm";
import CalendarRulesEditor from "./CalendarRulesEditor";
import InlineError from "../../ui/InlineError";

const NS = "suggestionSources:calendar";

type TestLine = { ok: boolean; text: string };

/**
 * Settings → TravTrack → Erkennung → Kalender (spec 2026-11-23, Part A): the
 * account's calendars, read only for the days the stop scan looks at. Each has
 * a test that reads it once and says what came back, or why nothing did.
 */
export default function CalendarSourcesSection(): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const fmt = useDisplayFormat();
  const isDemo = useIsDemoAccount();
  const [list, setList] = useState<CalendarSourceList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tests, setTests] = useState<Record<string, TestLine>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CalendarSource | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await calendarSourcesApi.list());
      setLoadError(null);
    } catch (e) {
      setLoadError(`suggestionSources:${calendarRequestFailureKey(e)}`);
      console.warn("calendar sources could not be loaded", e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const setGeocode = async (on: boolean) => {
    setBusy("geocode");
    setGeocodeError(null);
    try {
      const saved = await calendarSourcesApi.setGeocodeLocations(on);
      setList((l) => l && { ...l, geocodeLocations: saved });
    } catch (e) {
      console.warn("calendar geocode switch could not be saved", e);
      setGeocodeError("suggestionSources:calendar.geocode.error");
    } finally {
      setBusy(null);
    }
  };

  const runTest = async (source: CalendarSource) => {
    setBusy(source.id);
    try {
      const r = await calendarSourcesApi.test(source.id);
      setTests((m) => ({
        ...m,
        [source.id]: {
          ok: true,
          text:
            t(`${NS}.test.ok`, {
              count: r.events,
              from: fmt.date(r.from),
              to: fmt.date(r.to),
            }) + (r.skippedRules ? ` ${t(`${NS}.test.skipped`, { count: r.skippedRules })}` : ""),
        },
      }));
    } catch (e) {
      const key = calendarRequestFailureKey(e);
      console.warn("calendar test failed", key);
      setTests((m) => ({ ...m, [source.id]: { ok: false, text: t(`suggestionSources:${key}`) } }));
    } finally {
      setBusy(null);
      void load();
    }
  };

  const toggle = async (source: CalendarSource, enabled: boolean) => {
    setBusy(source.id);
    try {
      await calendarSourcesApi.update(source.id, { enabled });
      await load();
    } catch (e) {
      setTests((m) => ({
        ...m,
        [source.id]: { ok: false, text: t(`suggestionSources:${calendarRequestFailureKey(e)}`) },
      }));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (source: CalendarSource) => {
    setRemoving(null);
    setBusy(source.id);
    try {
      await calendarSourcesApi.remove(source.id);
      await load();
    } catch (e) {
      setTests((m) => ({
        ...m,
        [source.id]: { ok: false, text: t(`suggestionSources:${calendarRequestFailureKey(e)}`) },
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem title={t(`${NS}.title`)} sub={t(`${NS}.sub`)} help={t(`${NS}.help`)}>
          <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            {list?.blocked && <InlineError>{t(`${NS}.blocked.${list.blocked}`)}</InlineError>}
            {loadError && <InlineError>{t(loadError)}</InlineError>}
            {list?.sources.length === 0 && <p className="t-body">{t(`${NS}.empty`)}</p>}
            {list?.sources.map((source) => {
              const test = tests[source.id];
              const stored =
                source.lastStatus && source.lastStatus !== "ok"
                  ? t(
                      `suggestionSources:${calendarFailureKey(source.lastStatus, source.lastErrorCode)}`
                    )
                  : null;
              return (
                <div
                  key={source.id}
                  className="flex flex-col"
                  style={{
                    gap: "var(--ts-space-sm)",
                    padding: "var(--ts-space-md)",
                    border: "1px solid var(--ts-border)",
                    borderRadius: "var(--ts-radius-card)",
                  }}
                  data-testid="calendar-source"
                >
                  <Switch
                    id={`cal-on-${source.id}`}
                    checked={source.enabled}
                    disabled={isDemo || busy === source.id}
                    onChange={(on) => void toggle(source, on)}
                    label={source.label}
                    sub={
                      source.kind === "ics"
                        ? t(`${NS}.icsLine`, { host: source.icsHost ?? "" })
                        : t(`${NS}.caldavLine`, {
                            user: source.caldavUsername ?? "",
                            count: source.collections.length,
                          })
                    }
                  />
                  {stored && !test && (
                    <p className="t-caption" style={{ color: "var(--ts-bad)" }} role="status">
                      {t(`${NS}.lastFailed`)}: {stored}
                    </p>
                  )}
                  {test && (
                    <p
                      className="t-caption"
                      role={test.ok ? "status" : "alert"}
                      style={{ color: test.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
                    >
                      {test.text}
                    </p>
                  )}
                  <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                    <Button
                      disabled={isDemo || busy === source.id}
                      onClick={() => void runTest(source)}
                    >
                      {t(`${NS}.test.button`)}
                    </Button>
                    <Button
                      disabled={isDemo || busy === source.id}
                      onClick={() => setRemoving(source)}
                    >
                      {t(`${NS}.remove`)}
                    </Button>
                  </div>
                </div>
              );
            })}
            {adding ? (
              <CalendarSourceForm
                onAdded={() => {
                  setAdding(false);
                  void load();
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <div>
                <Button disabled={isDemo} onClick={() => setAdding(true)}>
                  {t(`${NS}.add`)}
                </Button>
              </div>
            )}
          </div>
        </SettingItem>
        <SettingItem title={t(`${NS}.privacy.title`)} sub={t(`${NS}.privacy.sub`)} />
        {list && (
          <SettingItem title={t(`${NS}.geocode.title`)} help={t(`${NS}.geocode.help`)}>
            <Switch
              id="cal-geocode"
              checked={list.geocodeLocations}
              disabled={isDemo || busy === "geocode"}
              onChange={(on) => void setGeocode(on)}
              label={t(`${NS}.geocode.label`)}
              sub={t(`${NS}.geocode.sub`)}
            />
            {geocodeError && <InlineError>{t(geocodeError)}</InlineError>}
          </SettingItem>
        )}
        {list && list.sources.length > 0 && (
          <CalendarRulesEditor sources={list.sources} disabled={isDemo} />
        )}
      </SettingRows>
      <ConfirmDialog
        open={removing !== null}
        title={t(`${NS}.removeConfirm.title`, { label: removing?.label ?? "" })}
        affects={t(`${NS}.removeConfirm.affects`)}
        amount={removing?.label ?? ""}
        after={t(`${NS}.removeConfirm.after`)}
        confirmLabel={t(`${NS}.remove`)}
        onConfirm={() => removing && void remove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </SectionCard>
  );
}
