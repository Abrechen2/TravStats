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

/** Each kind of failure is logged once per process, so a dead relay does not flood the log. */
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

function instanceName(publicUrl: string | null): string {
  try {
    return `TravStats ${publicUrl ? new URL(publicUrl).host : "self-hosted"}`;
  } catch {
    return "TravStats self-hosted";
  }
}

async function register(
  row: NonNullable<Awaited<ReturnType<typeof settings>>>,
  f: typeof fetch
): Promise<{ id: string; secret: string } | null> {
  const res = await f(`${row.pushRelayUrl}/v1/instances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: instanceName(row.publicUrl) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 201) {
    logOnce(`register:${res.status}`, `push relay registration answered ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { instanceId?: string; secret?: string };
  if (!body.instanceId || !body.secret) return null;
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: { pushInstanceId: body.instanceId, pushInstanceSecret: encryptApiKey(body.secret) },
  });
  return { id: body.instanceId, secret: body.secret };
}

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after"));
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
  return Math.min(ms, MAX_PAUSE_MS);
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
    const credentials = stored?.secret
      ? { id: stored.id, secret: stored.secret }
      : await register(row, f);
    if (!credentials) return "failed";

    const res = await f(`${row.pushRelayUrl}/v1/push`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.id}.${credentials.secret}`,
      },
      body: JSON.stringify(push),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    switch (res.status) {
      case 202:
        return "sent";
      case 410:
        return "token-invalid";
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
        await prisma.adminSettings.update({
          where: { id: row.id },
          data: { pushPausedUntil: new Date(now().getTime() + retryAfterMs(res)) },
        });
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
