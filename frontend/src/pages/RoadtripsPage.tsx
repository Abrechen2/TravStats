import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { SectionLabel } from "../components/ui/StatTile";
import LogbookTabs from "../components/table/LogbookTabs";
import ListFilterBar, { FilterField, PANEL_SELECT_CLASS } from "../components/table/ListFilterBar";
import ListEmptyState from "../components/table/ListEmptyState";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import { navigateAfterSave } from "../components/form";
import KindReviewNotice from "../components/Roadtrips/KindReviewNotice";
import NewRoadtripDialog from "../components/Roadtrips/NewRoadtripDialog";
import RoadtripCard from "../components/Roadtrips/RoadtripCard";
import UnderwayCard from "../components/Roadtrips/UnderwayCard";
import { useTranslation } from "../hooks/useTranslation";
import { roadtripsApi } from "../lib/api/roadtrips";
import { groupRoadtrips, roadtripPhase } from "../lib/roadtrip/roadtripView";
import { useTodayZone } from "../hooks/useTodayZone";
import { todayIn } from "../shared/time";
import type { StoredRoadtripVehicle } from "../shared/tour/roadtrip";
import type { RoadtripSummary } from "../types/roadtrip";

const GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

function Section({ label, children }: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

/** Loose match over what a reader remembers a trip by. */
function matches(r: RoadtripSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return [r.name, r.vehicleName, r.tripName, ...r.countries]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.toLowerCase().includes(q));
}

/**
 * Every roadtrip the reader owns (design 2026-09-25, board 1): the one they
 * are on right now first, then what is planned, then the past by year.
 *
 * Loading, failed and empty stay three different pictures, for the reason
 * every list here keeps them apart: "nothing yet" and "we could not ask"
 * look identical as an empty grid.
 */
export default function RoadtripsPage(): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const navigate = useNavigate();
  const todayZone = useTodayZone();
  const today = useMemo(() => todayIn(todayZone), [todayZone]);

  const [rows, setRows] = useState<RoadtripSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadLog, setLoadLog] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [vehicle, setVehicle] = useState<StoredRoadtripVehicle | "">("");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const data = await roadtripsApi.list();
      if (mountedRef.current) setRows(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setRows(null);
      setLoadError(true);
      setLoadLog(loadFailureLog(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const vehiclesInUse = useMemo(
    () => [...new Set((rows ?? []).flatMap((r) => (r.vehicle ? [r.vehicle] : [])))],
    [rows]
  );
  const shown = useMemo(
    () =>
      (rows ?? []).filter((r) => matches(r, query) && (vehicle === "" || r.vehicle === vehicle)),
    [rows, query, vehicle]
  );
  const groups = useMemo(() => groupRoadtrips(shown, today), [shown, today]);

  const card = (r: RoadtripSummary): JSX.Element => (
    <RoadtripCard key={r.id} roadtrip={r} phase={roadtripPhase(r.startDate, r.endDate, today)} />
  );

  const resetFilters = (): void => {
    setQuery("");
    setVehicle("");
  };

  return (
    <AppShell width="table">
      {/* Every other logbook page has carried these since round 4; this one
          was missed, so a reader who reached roadtrips had no way back to
          another area except the header menu (owner, 2026-09-28). */}
      <LogbookTabs />
      {/* The header every logbook carries (forgejo#197): title left, the
          add button right, the filter bar under it. The tiles stay — a
          roadtrip is read by its sketch, not by a row. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="t-screen-title">{t("roadtrips:pageTitle")}</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <span>+</span>
          <span>{t("roadtrips:newRoadtrip")}</span>
        </button>
      </div>

      <KindReviewNotice onChanged={() => void load()} />

      {rows !== null && rows.length > 0 && (
        <ListFilterBar
          search={{ value: query, onChange: setQuery, placeholder: t("roadtrips:list.search") }}
          extraActiveCount={vehicle === "" ? 0 : 1}
          extra={
            vehiclesInUse.length > 1 ? (
              <FilterField label={t("roadtrips:vehicleLabel")}>
                <select
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value as StoredRoadtripVehicle | "")}
                  className={PANEL_SELECT_CLASS}
                >
                  <option value="">{t("roadtrips:list.allVehicles")}</option>
                  {vehiclesInUse.map((v) => (
                    <option key={v} value={v}>
                      {t(`roadtrips:vehicle.${v}`)}
                    </option>
                  ))}
                </select>
              </FilterField>
            ) : undefined
          }
          hasActiveFilter={query.length > 0 || vehicle !== ""}
          onReset={resetFilters}
          resultLabel={t("common:filters.matching", { count: shown.length })}
        />
      )}

      {rows === null && !loadError && (
        <div className={GRID} aria-busy="true" aria-label={t("common:loading.default")}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: 250,
                borderRadius: "var(--ts-radius-card)",
                background: "var(--ts-surface)",
              }}
            />
          ))}
        </div>
      )}

      {loadError && (
        <ListLoadFailed
          title={t("roadtrips:loadError")}
          onRetry={() => void load()}
          log={loadLog}
        />
      )}

      {rows !== null && rows.length === 0 && (
        <EmptyState
          icon={<Icon name="caravan" size={24} />}
          title={t("roadtrips:list.emptyTitle")}
          description={t("roadtrips:empty")}
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              {t("roadtrips:list.emptyCta")}
            </Button>
          }
        />
      )}

      {/* Filtered to nothing: the way out is the reset — a filter set and
          forgotten must not read as "no roadtrips" (forgejo#250). */}
      {rows !== null && rows.length > 0 && shown.length === 0 && (
        <ListEmptyState
          filtered
          emptyTitle={t("roadtrips:list.emptyTitle")}
          emptyHint={t("roadtrips:empty")}
          onReset={resetFilters}
        />
      )}

      {shown.length > 0 && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          {groups.underway.length > 0 && (
            <Section label={t("roadtrips:list.sectionUnderway")}>
              {groups.underway.map((r) => (
                <UnderwayCard key={r.id} roadtrip={r} today={today} />
              ))}
            </Section>
          )}
          {groups.planned.length > 0 && (
            <Section label={t("roadtrips:list.sectionPlanned")}>
              <div className={GRID}>{groups.planned.map(card)}</div>
            </Section>
          )}
          {groups.years.map(({ year, rows: list }) => (
            <Section key={year} label={year}>
              <div className={GRID}>{list.map(card)}</div>
            </Section>
          ))}
          {groups.undated.length > 0 && (
            <Section label={t("roadtrips:list.sectionUndated")}>
              <div className={GRID}>{groups.undated.map(card)}</div>
            </Section>
          )}
        </div>
      )}

      <NewRoadtripDialog
        open={creating}
        onClose={() => setCreating(false)}
        // Straight to the new roadtrip, first station open: an empty
        // roadtrip has nothing to show, and its first station is next. Through
        // `navigateAfterSave`, because the dialog's unsaved-input guard may
        // still hold a history entry that a plain `navigate` would race.
        onCreated={(route) =>
          void navigateAfterSave(navigate, `/roadtrips/${route.id}?station=neu`)
        }
      />
    </AppShell>
  );
}
