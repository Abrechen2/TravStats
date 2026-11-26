import { useCallback, useEffect, useState, type JSX } from "react";
import { runtimeApi, type RuntimeReport, type SlowEntry } from "../../lib/api/runtime";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import { ErrorLine, SettingItem, StatusValue } from "../ui/settings";

/**
 * Maintenance › System: what the server process and its database are doing
 * right now (perf audit 2026-11, item 4). Read on open and on demand, never
 * polled: an admin looks at it when the instance feels slow.
 */
const LOOP_SLOW_P99_MS = 500;

function SlowList({ entries, empty }: { entries: SlowEntry[]; empty: string }): JSX.Element {
  if (entries.length === 0) return <StatusValue>{empty}</StatusValue>;
  return (
    <ul className="text-sm" style={{ margin: 0, paddingLeft: "1.2em" }}>
      {entries.slice(0, 8).map((e) => (
        <li key={`${e.key}-${e.recordedAt}`}>
          <code>{e.key}</code> · {e.durationMs} ms
          {e.suppressed > 0 ? ` (+${e.suppressed})` : ""}
        </li>
      ))}
    </ul>
  );
}

export default function MaintenanceRuntime(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const k = (key: string, values?: Record<string, unknown>) =>
    t(`settingsRows:maintenance.runtime.${key}`, values);
  const [report, setReport] = useState<RuntimeReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setReport(await runtimeApi.get());
      setFailed(false);
    } catch (error) {
      logger.warn("Failed to load the runtime report:", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const loop = report?.eventLoop ?? null;
  const pool = report?.database.pool ?? null;
  const statements = report?.database.statements;
  const heavy = report?.jobs.heavySlot;
  const imports = report?.jobs.importWriteSlot;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <strong>{k("title")}</strong>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {k("refresh")}
        </Button>
      </div>
      {failed ? <ErrorLine>{k("loadFailed")}</ErrorLine> : null}
      <SettingItem
        title={k("loop.title")}
        sub={k("loop.sub")}
        scope="allAccounts"
        expert
        control={
          <StatusValue>
            {loop
              ? k(loop.p99Ms > LOOP_SLOW_P99_MS ? "loop.slow" : "loop.value", {
                  p50: loop.p50Ms,
                  p99: loop.p99Ms,
                  max: loop.maxMs,
                })
              : "…"}
          </StatusValue>
        }
      />
      <SettingItem
        title={k("memory.title")}
        scope="allAccounts"
        expert
        control={
          <StatusValue>
            {report
              ? k("memory.value", {
                  heap: report.memory.heapUsedMb,
                  limit: report.memory.heapLimitMb,
                  rss: report.memory.rssMb,
                })
              : "…"}
          </StatusValue>
        }
      />
      <SettingItem
        title={k("database.title")}
        scope="allAccounts"
        expert
        error={report && !report.database.ping.ok ? k("database.failed") : undefined}
        control={
          <StatusValue>
            {report?.database.ping.ok
              ? k(pool ? "database.value" : "database.valueNoPool", {
                  latency: report.database.ping.latencyMs,
                  total: pool?.total,
                  max: pool?.max,
                  idle: pool?.idle,
                  waiting: pool?.waiting,
                })
              : "…"}
          </StatusValue>
        }
      />
      <SettingItem
        title={k("statements.title")}
        sub={
          statements && statements.status !== "available"
            ? k(`statements.${statements.status}`)
            : k("statements.sub")
        }
        scope="allAccounts"
        expert
      >
        {statements?.status === "available" ? (
          statements.statements.length === 0 ? (
            <StatusValue>{k("statements.none")}</StatusValue>
          ) : (
            <ul className="text-sm" style={{ margin: 0, paddingLeft: "1.2em" }}>
              {statements.statements.map((s, i) => (
                <li key={i} style={{ wordBreak: "break-all" }}>
                  {k("statements.row", { mean: s.meanMs, max: s.maxMs, calls: s.calls })}{" "}
                  <code>{s.query}</code>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </SettingItem>
      <SettingItem
        title={k("jobs.title")}
        scope="allAccounts"
        expert
        control={
          <StatusValue>
            {heavy && imports
              ? [
                  heavy.running ? k("jobs.running", { name: heavy.running.name }) : k("jobs.idle"),
                  heavy.waiting.length > 0
                    ? k("jobs.waiting", { count: heavy.waiting.length })
                    : "",
                  imports.held > 0 ? k("jobs.importRunning", { count: imports.waiting }) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "…"}
          </StatusValue>
        }
      />
      <SettingItem
        title={k("slowRequests.title")}
        sub={k("slowRequests.sub")}
        scope="allAccounts"
        expert
      >
        {report ? <SlowList entries={report.slowRequests} empty={k("slowNone")} /> : null}
      </SettingItem>
      <SettingItem
        title={k("slowQueries.title")}
        sub={k("slowQueries.sub")}
        scope="allAccounts"
        expert
      >
        {report ? <SlowList entries={report.slowQueries} empty={k("slowNone")} /> : null}
      </SettingItem>
    </div>
  );
}
