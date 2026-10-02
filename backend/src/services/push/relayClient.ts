import { prisma } from "../../db";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { systemLogger } from "../../utils/logger";

/**
 * The client of the push relay (push.travstats.de, spec §3.3, TravStats#156).
 *
 * - Nothing at all happens while the admin has not switched push on: no
 *   registration, no request (owner decision 2026-10-01).
 * - The first push registers this instance (`POST /v1/instances`) and keeps
 *   the id and the encrypted secret in AdminSettings.
 * - It never throws: a push is a courtesy on top of the status job, which
 *   must never fail or wait because of it. Every outcome is a value.
 */
export type RelayOutcome = "sent" | "token-invalid" | "paused" | "disabled" | "failed";

export type RelayPush = {
  platform: "ios" | "android";
  token: string;
  apnsEnvironment?: string | null;
  ciphertext: string;
  collapseId?: string;
  lang?: "de" | "en";
};

type Deps = { fetch?: typeof fetch; now?: () => Date };

const TIMEOUT_MS = 8_000;
const MAX_PAUSE_MS = 24 * 60 * 60 * 1000;

/**
 * Each kind of failure is logged once per outage, so a dead relay does not
 * flood the log. A successful push ends the outage: the next failure is news
 * again and is logged.
 */
const logged = new Set<string>();
function logOnce(key: string, message: string): void {
  if (logged.has(key)) return;
  logged.add(key);
  systemLogger.warn({ operation: "push_relay", message });
}

async function settings() {
  return prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: {
      id: true,
      pushEnabled: true,
      pushRelayUrl: true,
      pushInstanceId: true,
      pushInstanceSecret: true,
      pushPausedUntil: true,
      publicUrl: true,
    },
  });
}

/** The relay's rule for an instance name (travstats-push `src/schema.ts`). */
const NAME_MAX = 64;
const NAME_REJECTED = /[^\p{L}\p{N} ._'()-]/gu;

/**
 * "TravStats <hostname>", in characters the relay accepts: no port (the
 * relay rejects ':'), an IPv6 literal without its brackets and with '-' for
 * ':', cut to the relay's maximum length. A name the relay refuses would
 * fail every registration with 400, forever.
 */
export function instanceName(publicUrl: string | null): string {
  let host = "self-hosted";
  try {
    if (publicUrl) host = new URL(publicUrl).hostname.replace(/[[\]]/g, "") || host;
  } catch {
    // Not a URL: keep the neutral name.
  }
  return `TravStats ${host}`.replace(NAME_REJECTED, "-").slice(0, NAME_MAX).trim();
}

type Credentials = { id: string; secret: string };
type Registration =
  { kind: "ok"; credentials: Credentials } | { kind: "paused" } | { kind: "failed" };

async function register(
  row: NonNullable<Awaited<ReturnType<typeof settings>>>,
  f: typeof fetch,
  now: () => Date
): Promise<Registration> {
  const res = await f(`${row.pushRelayUrl}/v1/instances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: instanceName(row.publicUrl) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) {
    // The relay's registration limit: wait as long as it says, like a push.
    await pause(row.id, res, now);
    logOnce("register:429", "push relay registration limit reached; paused until Retry-After");
    return { kind: "paused" };
  }
  if (res.status !== 201) {
    logOnce(`register:${res.status}`, `push relay registration answered ${res.status}`);
    return { kind: "failed" };
  }
  const body = (await res.json()) as { instanceId?: string; secret?: string };
  if (!body.instanceId || !body.secret) return { kind: "failed" };
  // Conditional write: the admin may have switched push off, reset it or
  // changed the relay address while the request was in flight. Credentials
  // must not come back after that, and must not be used for this send.
  const stored = await prisma.adminSettings.updateMany({
    where: {
      id: row.id,
      pushEnabled: true,
      pushRelayUrl: row.pushRelayUrl,
      pushInstanceId: null,
    },
    data: { pushInstanceId: body.instanceId, pushInstanceSecret: encryptApiKey(body.secret) },
  });
  if (stored.count === 0) {
    logOnce("register:superseded", "push settings changed during registration; result dropped");
    return { kind: "failed" };
  }
  return { kind: "ok", credentials: { id: body.instanceId, secret: body.secret } };
}

/**
 * One registration at a time per relay address in this process: two first
 * pushes that start together (the status job and the reminder cron) share
 * it instead of each creating an instance on the relay.
 */
const registering = new Map<string, Promise<Registration>>();
function registerOnce(
  row: NonNullable<Awaited<ReturnType<typeof settings>>>,
  f: typeof fetch,
  now: () => Date
): Promise<Registration> {
  const key = row.pushRelayUrl;
  const running = registering.get(key);
  if (running) return running;
  const started = register(row, f, now).finally(() => registering.delete(key));
  registering.set(key, started);
  return started;
}

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after"));
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
  return Math.min(ms, MAX_PAUSE_MS);
}

async function pause(id: number, res: Response, now: () => Date): Promise<void> {
  await prisma.adminSettings.update({
    where: { id },
    data: { pushPausedUntil: new Date(now().getTime() + retryAfterMs(res)) },
  });
}

/** The relay's 410 names a dead device token; anything else at 410 is not proof of that. */
async function saysTokenInvalid(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { reason?: unknown };
    return body?.reason === "token-invalid";
  } catch {
    return false;
  }
}

/**
 * The relay's schema declares every optional field as "absent or valid", so
 * a null (an Android device has no APNs environment) is a 400. Leave out
 * every field that has no value.
 */
function relayBody(push: RelayPush): Record<string, unknown> {
  return Object.fromEntries(Object.entries(push).filter(([, v]) => v !== null && v !== undefined));
}

export async function sendToRelay(push: RelayPush, deps: Deps = {}): Promise<RelayOutcome> {
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  try {
    const row = await settings();
    if (!row?.pushEnabled) return "disabled";
    if (row.pushPausedUntil && row.pushPausedUntil > now()) return "paused";

    const stored =
      row.pushInstanceId && row.pushInstanceSecret
        ? { id: row.pushInstanceId, secret: decryptApiKey(row.pushInstanceSecret) }
        : null;
    let credentials: Credentials;
    if (stored?.secret) {
      credentials = { id: stored.id, secret: stored.secret };
    } else {
      const registration = await registerOnce(row, f, now);
      if (registration.kind !== "ok") return registration.kind;
      credentials = registration.credentials;
    }

    const res = await f(`${row.pushRelayUrl}/v1/push`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.id}.${credentials.secret}`,
      },
      body: JSON.stringify(relayBody(push)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    switch (res.status) {
      case 202:
        logged.clear();
        return "sent";
      case 410:
        if (await saysTokenInvalid(res)) return "token-invalid";
        logOnce("410:unexpected", "push relay answered 410 without naming the token invalid");
        return "failed";
      case 401:
        // The relay no longer knows us (reset, or our secret is wrong):
        // register anew on the next push.
        await prisma.adminSettings.update({
          where: { id: row.id },
          data: { pushInstanceId: null, pushInstanceSecret: null },
        });
        logOnce("401", "push relay rejected this instance's credentials; it will register again");
        return "failed";
      case 429:
        await pause(row.id, res, now);
        logOnce(
          "429",
          "push relay daily limit reached; pushes paused until the relay's Retry-After"
        );
        return "paused";
      default:
        logOnce(`status:${res.status}`, `push relay answered ${res.status}`);
        return "failed";
    }
  } catch (err) {
    logOnce(
      `error:${(err as Error)?.name}`,
      `push relay unreachable: ${(err as Error)?.message ?? err}`
    );
    return "failed";
  }
}
