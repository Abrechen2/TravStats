import { monitorEventLoopDelay, type IntervalHistogram } from "perf_hooks";
import v8 from "v8";

import { prisma } from "../../db";
import { appPoolStats, type PoolStats } from "../../prismaClient";
import { heavyJobSlot, type HeavySlotState } from "../jobs/heavySlot";
import { importWriteSlot } from "../travtrack/imports/writeSlot";
import { slowQueries, slowRequests, type SlowEntry } from "./slowLog";

/**
 * What the process and its database are doing right now (perf audit 2026-11,
 * item 4), for the admin runtime card and, reduced to two words, for /health.
 * The 24.11 incident read "load 15, unknown why"; this names the cause.
 */

/** Histogram resolution; 20 ms is enough to see a blocked loop and costs nothing. */
const LOOP_RESOLUTION_MS = 20;
/** The loop figures cover this window, then start afresh. */
const LOOP_WINDOW_MS = 60_000;
/** Above this p99 the loop counts as slow on /health. */
export const LOOP_SLOW_P99_MS = 500;
/** /health asks the database at most this often; probes in between get the cached answer. */
const DB_PING_CACHE_MS = 10_000;
const DB_PING_TIMEOUT_MS = 2_000;
const SLOW_STATEMENTS_SHOWN = 10;
const STATEMENT_TEXT_MAX = 400;

export interface LoopDelay {
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  windowMs: number;
}

let histogram: IntervalHistogram | null = null;
let lastWindow: LoopDelay | null = null;
let windowTimer: NodeJS.Timeout | null = null;

const toMs = (ns: number) => Math.round((ns / 1e6) * 10) / 10;

function readHistogram(h: IntervalHistogram, windowMs: number): LoopDelay {
  return {
    p50Ms: toMs(h.percentile(50)),
    p99Ms: toMs(h.percentile(99)),
    maxMs: toMs(h.max),
    windowMs,
  };
}

/** Starts the event-loop monitor once; called at boot. */
export function startRuntimeMonitor(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  histogram.enable();
  windowTimer = setInterval(() => {
    if (!histogram) return;
    lastWindow = readHistogram(histogram, LOOP_WINDOW_MS);
    histogram.reset();
  }, LOOP_WINDOW_MS);
  windowTimer.unref();
}

export function stopRuntimeMonitor(): void {
  histogram?.disable();
  histogram = null;
  if (windowTimer) clearInterval(windowTimer);
  windowTimer = null;
  lastWindow = null;
}

/** The last full minute, or the current partial one before the first minute is over. */
export function loopDelay(): LoopDelay | null {
  if (lastWindow) return lastWindow;
  if (histogram && histogram.count > 0) return readHistogram(histogram, 0);
  return null;
}

export interface DbPing {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

/** `SELECT 1` with its own deadline; a hung database answers "failed", never hangs the caller. */
export async function pingDatabase(timeoutMs = DB_PING_TIMEOUT_MS): Promise<DbPing> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRawUnsafe("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Math.round((performance.now() - started) * 10) / 10 };
  } catch (err) {
    return {
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let cachedPing: { at: number; result: Promise<DbPing> } | null = null;

/** The ping /health uses: at most one real `SELECT 1` per 10 s, however often it is probed. */
export function cachedDatabasePing(now = Date.now()): Promise<DbPing> {
  if (!cachedPing || now - cachedPing.at >= DB_PING_CACHE_MS) {
    cachedPing = { at: now, result: pingDatabase() };
  }
  return cachedPing.result;
}

export function __resetPingCacheForTests(): void {
  cachedPing = null;
}

export type StatementsStatus = "available" | "notInstalled" | "notLoaded" | "error";

export interface SlowStatement {
  query: string;
  calls: number;
  meanMs: number;
  maxMs: number;
  totalMs: number;
  rows: number;
}

export interface StatementsReport {
  status: StatementsStatus;
  statements: SlowStatement[];
  error?: string;
}

/**
 * The slowest statements by mean time, from pg_stat_statements when it is
 * installed AND preloaded. Statement texts are normalised by Postgres
 * (constants become `$1`), so they carry no user data.
 */
export async function slowStatements(): Promise<StatementsReport> {
  try {
    const ext = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      "SELECT count(*) AS n FROM pg_extension WHERE extname = 'pg_stat_statements'"
    );
    if (Number(ext[0]?.n ?? 0) === 0) return { status: "notInstalled", statements: [] };
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        query: string;
        calls: bigint;
        mean: number;
        max: number;
        total: number;
        rows: bigint;
      }>
    >(
      `SELECT query, calls, mean_exec_time AS mean, max_exec_time AS max,
              total_exec_time AS total, rows
         FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY mean_exec_time DESC
        LIMIT ${SLOW_STATEMENTS_SHOWN}`
    );
    return {
      status: "available",
      statements: rows.map((r) => ({
        query:
          r.query.length > STATEMENT_TEXT_MAX
            ? `${r.query.slice(0, STATEMENT_TEXT_MAX)}…`
            : r.query,
        calls: Number(r.calls),
        meanMs: Math.round(r.mean * 10) / 10,
        maxMs: Math.round(r.max * 10) / 10,
        totalMs: Math.round(r.total),
        rows: Number(r.rows),
      })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Installed but missing from shared_preload_libraries.
    if (/shared_preload_libraries/i.test(message)) return { status: "notLoaded", statements: [] };
    return { status: "error", statements: [], error: message.slice(0, 200) };
  }
}

export interface RuntimeReport {
  checkedAt: string;
  uptimeSeconds: number;
  eventLoop: LoopDelay | null;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    heapLimitMb: number;
    externalMb: number;
  };
  database: { ping: DbPing; pool: PoolStats | null; statements: StatementsReport };
  jobs: {
    heavySlot: HeavySlotState;
    importWriteSlot: { held: number; waiting: number };
  };
  slowRequests: SlowEntry[];
  slowQueries: SlowEntry[];
}

const mb = (bytes: number) => Math.round(bytes / 1048576);

export async function runtimeReport(): Promise<RuntimeReport> {
  const mem = process.memoryUsage();
  const [ping, statements] = await Promise.all([pingDatabase(), slowStatements()]);
  return {
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    eventLoop: loopDelay(),
    memory: {
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      heapLimitMb: mb(v8.getHeapStatistics().heap_size_limit),
      externalMb: mb(mem.external),
    },
    database: { ping, pool: appPoolStats(), statements },
    jobs: {
      heavySlot: heavyJobSlot.state(),
      importWriteSlot: { held: importWriteSlot.held(), waiting: importWriteSlot.waiting() },
    },
    slowRequests: slowRequests.recent(),
    slowQueries: slowQueries.recent(),
  };
}

/** The two words /health shows: no figures, nothing a stranger can use. */
export async function healthChecks(): Promise<{
  database: "ok" | "failed";
  eventLoop: "ok" | "slow" | "pending";
}> {
  const ping = await cachedDatabasePing();
  const loop = loopDelay();
  return {
    database: ping.ok ? "ok" : "failed",
    eventLoop: loop === null ? "pending" : loop.p99Ms > LOOP_SLOW_P99_MS ? "slow" : "ok",
  };
}
