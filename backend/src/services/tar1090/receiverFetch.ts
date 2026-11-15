/**
 * Fetch one aircraft's trace for a past flight from the user's OWN tar1090 /
 * readsb receiver (forgejo#408 phase 3). Every outcome is explicit: points, or
 * one reason — nothing turns a failure into "no track".
 *
 * Files tried per UTC day, in order (404 moves on to the next, anything else
 * is that day's failure):
 *   1. `globe_history/YYYY/MM/DD/traces/<hex[-2:]>/trace_full_<hex>.json`
 *      (tar1090 with `--write-globe-history` / `GLOBE_HISTORY` served)
 *   2. `data/traces/<hex[-2:]>/trace_full_<hex>.json` (today's full trace)
 *   3. `data/traces/<hex[-2:]>/trace_recent_<hex>.json` (the last hours)
 */

import axios from "axios";

import { prisma } from "../../db";
import type { FlightTrackPoint } from "../../schemas/flightDevice";
import { classifyProviderError } from "../flightLookup/providerOutcome";
import {
  axiosAgentsFor,
  accountMayReachPrivate,
  assertTargetAllowed,
  isPrivateTargetRefusal,
  type TargetPolicy,
} from "../egress/privateTargets";
import { connectionGate } from "../externalServices/policy";
import { parseTrace, pickLegInWindow, type TraceLeg } from "./traceFormat";

export const RECEIVER_REASONS = [
  "off",
  "not_configured",
  "private_target",
  "not_found",
  "outside_window",
  "auth",
  "timeout",
  "unreachable",
  "provider_error",
  "bad_trace",
] as const;
export type ReceiverReason = (typeof RECEIVER_REASONS)[number];

export type ReceiverTrackResult =
  | { ok: true; points: FlightTrackPoint[]; registration: string | null }
  | { ok: false; reason: ReceiverReason };

export interface Receiver {
  baseUrl: string;
  policy: TargetPolicy;
}

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 30 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** Legs of two day files this close are one flight that crossed midnight UTC. */
const JOIN_GAP_MS = 15 * 60_000;
/** How far around the schedule window a leg is kept (delays, taxiing). */
const LEG_MARGIN_BEFORE_MS = 3 * 3_600_000;
const LEG_MARGIN_AFTER_MS = 6 * 3_600_000;

export type ReceiverResolution =
  { ok: true; receiver: Receiver } | { ok: false; reason: "off" | "not_configured" };

/**
 * The receiver this account may use: its own address, else the instance's.
 * The admin policy switch and the account's own "off" both win; an ordinary
 * account's own address is checked against the public-only rule on every use
 * (an admin demoted since saving loses the LAN target at once).
 */
export async function resolveReceiver(userId: string): Promise<ReceiverResolution> {
  const gate = await connectionGate("tar1090", userId);
  if (gate.off) return { ok: false, reason: "off" };
  const [user, admin, mayReachPrivate] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId }, select: { tar1090BaseUrl: true } }),
    prisma.adminSettings.findFirst({
      orderBy: { id: "asc" },
      select: { globalTar1090BaseUrl: true },
    }),
    accountMayReachPrivate(userId),
  ]);
  if (user?.tar1090BaseUrl && gate.accountMayConnect) {
    return {
      ok: true,
      receiver: { baseUrl: user.tar1090BaseUrl, policy: { allowPrivate: mayReachPrivate } },
    };
  }
  if (admin?.globalTar1090BaseUrl) {
    // The instance tier is the operator's own address: LAN allowed.
    return {
      ok: true,
      receiver: { baseUrl: admin.globalTar1090BaseUrl, policy: { allowPrivate: true } },
    };
  }
  return { ok: false, reason: "not_configured" };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function traceUrls(baseUrl: string, hex: string, dayStartMs: number): string[] {
  const base = baseUrl.replace(/\/+$/, "");
  const h = hex.toLowerCase();
  const d = new Date(dayStartMs);
  const dir = `traces/${h.slice(-2)}`;
  return [
    `${base}/globe_history/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${dir}/trace_full_${h}.json`,
    `${base}/data/${dir}/trace_full_${h}.json`,
    `${base}/data/${dir}/trace_recent_${h}.json`,
  ];
}

type FileOutcome =
  | { kind: "legs"; legs: TraceLeg[]; registration: string | null }
  | { kind: "missing" }
  | { kind: "failed"; reason: ReceiverReason };

async function fetchTraceFile(receiver: Receiver, url: string): Promise<FileOutcome> {
  try {
    assertTargetAllowed(url, receiver.policy);
    const response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_BYTES,
      headers: { Accept: "application/json" },
      validateStatus: (status) => status === 200 || status === 404,
      ...axiosAgentsFor(receiver.policy),
    });
    if (response.status === 404) return { kind: "missing" };
    const parsed = parseTrace(response.data);
    if (!parsed.ok) return { kind: "failed", reason: "bad_trace" };
    return { kind: "legs", legs: parsed.legs, registration: parsed.registration };
  } catch (error) {
    if (isPrivateTargetRefusal(error)) return { kind: "failed", reason: "private_target" };
    const kind = classifyProviderError(error);
    if (kind === "auth") return { kind: "failed", reason: "auth" };
    if (kind === "timeout") return { kind: "failed", reason: "timeout" };
    const code = (error as { code?: string }).code;
    if (
      code &&
      /^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EAI_AGAIN)$/.test(code)
    ) {
      return { kind: "failed", reason: "unreachable" };
    }
    return { kind: "failed", reason: "provider_error" };
  }
}

/**
 * Legs of several day files as one list: whole-leg duplicates dropped (the
 * receiver's own `data/traces` file is the same file for every day asked), and
 * a leg that starts within the previous day's last leg, or shortly after it, is
 * the same flight across midnight UTC and is merged by time.
 */
export function joinAcrossDays(days: readonly TraceLeg[][]): TraceLeg[] {
  const out: TraceLeg[] = [];
  const seen = new Set<string>();
  days.forEach((legs, index) => {
    legs.forEach((leg, i) => {
      const key = `${leg.points[0].t}:${leg.points.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      const prev = out[out.length - 1];
      const gap = prev ? leg.points[0].t - prev.points[prev.points.length - 1].t : Infinity;
      if (index > 0 && i === 0 && prev && gap <= JOIN_GAP_MS) {
        const byTime = new Map<number, FlightTrackPoint>();
        for (const point of [...prev.points, ...leg.points]) byTime.set(point.t, point);
        prev.points = [...byTime.values()].sort((x, y) => x.t - y.t);
      } else {
        out.push({ points: [...leg.points] });
      }
    });
  });
  return out;
}

/** The trace of `hex` for the flight window `[fromMs, toMs]` (UTC), or the one reason it cannot be had. */
export async function fetchReceiverTrack(
  receiver: Receiver,
  hex: string,
  fromMs: number,
  toMs: number
): Promise<ReceiverTrackResult> {
  const firstDay = Math.floor(fromMs / DAY_MS) * DAY_MS;
  const lastDay = Math.floor(toMs / DAY_MS) * DAY_MS;
  const dayLegs: TraceLeg[][] = [];
  let registration: string | null = null;
  let anyFile = false;

  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    let found = false;
    let dayFailure: ReceiverReason | null = null;
    for (const url of traceUrls(receiver.baseUrl, hex, day)) {
      const outcome = await fetchTraceFile(receiver, url);
      if (outcome.kind === "missing") continue;
      if (outcome.kind === "failed") {
        dayFailure ??= outcome.reason;
        // A refused address or a dead host will not answer better on the next file.
        if (outcome.reason === "private_target" || outcome.reason === "unreachable") {
          return { ok: false, reason: outcome.reason };
        }
        continue;
      }
      dayLegs.push(outcome.legs);
      registration ??= outcome.registration;
      found = true;
      anyFile = true;
      break;
    }
    // A day that failed (not merely missing) makes the line incomplete: a
    // partial track must not replace a complete one, so the reason is reported.
    if (!found && dayFailure) return { ok: false, reason: dayFailure };
  }
  if (!anyFile) return { ok: false, reason: "not_found" };

  const leg = pickLegInWindow(joinAcrossDays(dayLegs), fromMs, toMs);
  // The leg must hold fixes DURING the flight window, not merely span it (a gap
  // over the whole flight is no evidence), and keeps only a bounded margin around it.
  const points = leg?.points.filter(
    (p) => p.t >= fromMs - LEG_MARGIN_BEFORE_MS && p.t <= toMs + LEG_MARGIN_AFTER_MS
  );
  const inWindow = points?.filter((p) => p.t >= fromMs && p.t <= toMs).length ?? 0;
  if (!points || inWindow < 2) return { ok: false, reason: "outside_window" };
  return { ok: true, points, registration };
}
