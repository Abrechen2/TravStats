import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { ABSENT_MARKER, formatMetricOrAbsent } from "../../lib/comparison/formatMetric";
import { logger } from "../../lib/logger";
import { LEADERBOARD_METRICS } from "../../shared/comparisonMetrics";
import { useSettingsStore } from "../../store/settingsStore";
import {
  REMOTE_STATS_ENTITIES,
  type RemoteEntriesPage,
  type RemoteOverview,
  type RemotePerson,
} from "../../types/sharingRemote";
import { remoteSharingError, type RemoteSharingError } from "../sharing/remoteSharingCopy";
import Button from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";

const NS = "sharing:remote.connected.stats";

/** A few readable facts of one wire entry: primitives only, no ids. */
const shown = (facts: Record<string, unknown>): string =>
  Object.entries(facts)
    .filter(([, v]) => ["string", "number"].includes(typeof v) && v !== "")
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");

/**
 * What one person on another server shows the caller (read-only): the totals (Übersicht, lifetime
 * or one year) and, if they show the full level, the entries behind them page by page. A refusal
 * is its own sentence — "not shared" is never drawn as an empty page.
 */
export default function RemotePersonStats({ person }: { person: RemotePerson }): JSX.Element {
  const { t, i18n } = useTranslation(["sharing", "comparison"]);
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const [year, setYear] = useState("");
  const [overview, setOverview] = useState<RemoteOverview | null>(null);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);
  const [entity, setEntity] = useState<string>(REMOTE_STATS_ENTITIES[0]);
  const [page, setPage] = useState<RemoteEntriesPage | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      logger.error("Reading a remote person's statistics failed:", error);
      setFailure(remoteSharingError(error, "sharing:remote.errors.statsFailed"));
    } finally {
      setBusy(false);
    }
  };

  const load = (): void =>
    void run(async () => {
      setPage(null);
      const y = year.trim() === "" ? null : Number(year);
      setOverview(await sharingRemoteApi.personStats(person.id, y));
    });

  const loadEntries = (offset: number, kind: string): void =>
    void run(async () => {
      const next = await sharingRemoteApi.personEntries(person.id, kind, offset);
      setPage((current) =>
        offset > 0 && current && current.entity === kind
          ? { ...next, entries: [...current.entries, ...next.entries] }
          : next
      );
    });

  const tr = (key: string, options?: Record<string, unknown>): string => t(key, options) as string;

  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="remote-person-stats">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <Field label={t(`${NS}.year`)} htmlFor={`rs-year-${person.id}`}>
            <Input
              id={`rs-year-${person.id}`}
              inputMode="numeric"
              value={year}
              placeholder={t(`${NS}.allTime`)}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </Field>
        </div>
        <Button variant="primary" disabled={busy} onClick={load}>
          {t(`${NS}.load`)}
        </Button>
      </div>
      {failure && (
        <p role="alert" style={{ color: "var(--ts-warn)" }}>
          {t(failure.key, { origin: failure.origin })}
        </p>
      )}
      {overview && (
        <>
          <p className="t-caption">{t(`${NS}.level.${overview.level}`)}</p>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>{t(`${NS}.metric`)}</th>
                <th>{t(`${NS}.value`)}</th>
              </tr>
            </thead>
            <tbody>
              {LEADERBOARD_METRICS.filter((m) => m.key in overview.snapshot.metrics).map((m) => (
                <tr key={m.key}>
                  <td>{t(`comparison:metric.${m.key}`)}</td>
                  <td>
                    {formatMetricOrAbsent(overview.snapshot.metrics[m.key], m.unit, {
                      distanceUnit,
                      t: tr,
                      language: i18n.language,
                    }) || ABSENT_MARKER}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {overview?.level === "full" && (
        <div className="flex flex-col gap-2">
          <Field label={t(`${NS}.entity`)} htmlFor={`rs-entity-${person.id}`}>
            <Select
              id={`rs-entity-${person.id}`}
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                loadEntries(0, e.target.value);
              }}
            >
              {REMOTE_STATS_ENTITIES.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`${NS}.entities.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={busy} onClick={() => loadEntries(0, entity)}>
            {t(`${NS}.entries`)}
          </Button>
          {page && page.total === 0 && <p className="t-caption">{t(`${NS}.empty`)}</p>}
          {page && page.total > 0 && (
            <>
              <p className="t-caption">
                {t(`${NS}.of`, { shown: page.entries.length, total: page.total })}
              </p>
              <ul className="flex flex-col gap-1">
                {page.entries.map((entry) => (
                  <li key={entry.shareKey}>{shown(entry.facts)}</li>
                ))}
              </ul>
              {page.entries.length < page.total && (
                <div>
                  <Button disabled={busy} onClick={() => loadEntries(page.entries.length, entity)}>
                    {t(`${NS}.more`)}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
