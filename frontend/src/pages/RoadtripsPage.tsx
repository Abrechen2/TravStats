import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import PageHeader from "../components/ui/PageHeader";
import { Input, Select } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { SectionLabel } from "../components/ui/StatTile";
import KindReviewNotice from "../components/Roadtrips/KindReviewNotice";
import NewRoadtripDialog from "../components/Roadtrips/NewRoadtripDialog";
import RoadtripCard from "../components/Roadtrips/RoadtripCard";
import UnderwayCard from "../components/Roadtrips/UnderwayCard";
import { useTranslation } from "../hooks/useTranslation";
import { roadtripsApi } from "../lib/api/roadtrips";
import { groupRoadtrips, localToday, roadtripPhase } from "../lib/roadtrip/roadtripView";
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
  const today = useMemo(() => localToday(), []);

  const [rows, setRows] = useState<RoadtripSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
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
    } catch {
      if (!mountedRef.current) return;
      setRows(null);
      setLoadError(true);
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

  const newButton = (
    <Button
      variant="primary"
      icon={<Icon name="plus" size={16} />}
      onClick={() => setCreating(true)}
    >
      {t("roadtrips:newRoadtrip")}
    </Button>
  );

  return (
    <AppShell width="table">
      <PageHeader title={t("roadtrips:pageTitle")} actions={newButton} />

      <KindReviewNotice onChanged={() => void load()} />

      {rows !== null && rows.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <div className="min-w-60 flex-1 sm:max-w-80">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("roadtrips:list.search")}
              aria-label={t("roadtrips:list.search")}
            />
          </div>
          {vehiclesInUse.length > 1 && (
            <div className="w-48">
              <Select
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value as StoredRoadtripVehicle | "")}
                aria-label={t("roadtrips:vehicleLabel")}
              >
                <option value="">{t("roadtrips:list.allVehicles")}</option>
                {vehiclesInUse.map((v) => (
                  <option key={v} value={v}>
                    {t(`roadtrips:vehicle.${v}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
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
        <EmptyState
          kind="degraded"
          title={t("roadtrips:loadError")}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t("common:buttons.retry")}
            </Button>
          }
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

      {rows !== null && rows.length > 0 && shown.length === 0 && (
        <p className="t-caption py-8 text-center">{t("roadtrips:list.noMatch")}</p>
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
        // roadtrip has nothing to show, and its first station is next.
        onCreated={(route) => navigate(`/roadtrips/${route.id}?station=neu`)}
      />
    </AppShell>
  );
}
