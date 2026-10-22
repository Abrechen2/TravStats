import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import type { Duplex } from "stream";

import { isLocalLlmHost } from "../llm/llmEndpoint";
import { WebdavSyncError } from "./errors";

/**
 * Where a per-account WebDAV sync may connect — the SSRF boundary of the
 * feature (forgejo#321).
 *
 * Immich, Dawarich and the model endpoints deliberately allow any host,
 * private ranges included (`normalizeImmichBaseUrl`): their URL is set by the
 * operator, or by a user of a single-tenant instance, and the target is a LAN
 * server by design. This target is different in two ways that decide it:
 *
 *  - any account on a multi-user instance can set it, not only the operator;
 *  - the request is a PUT of a whole file with credentials, run unattended
 *    every night, and its failure code is shown back — a scanner of the
 *    instance's own network if the host were free.
 *
 * So the rule is stricter and depends on who asks:
 *
 *  - an ordinary account reaches PUBLIC addresses only, over https. Every
 *    address a name resolves to is checked when the socket opens — on every
 *    connection, redirects included — so a DNS answer that changes between
 *    the check and the request (rebinding) gains nothing;
 *  - an admin account may name a LAN share (Nextcloud on the NAS is the
 *    common case), as it may for every other integration: an admin already
 *    controls the instance, so the check would protect nothing. Plain http is
 *    accepted for an admin only towards a LAN host — over the internet it
 *    would send the password in the clear.
 *
 * Whether the caller is an admin is read on every RUN, not only when saving:
 * an account demoted after setting a LAN target loses it on the next run.
 */

export interface TargetPolicy {
  /** May the share be on a private, loopback or link-local address? */
  allowPrivate: boolean;
}

/** Ranges no ordinary account may reach: not the public internet. */
const BLOCKED = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
  ["64:ff9b::", 96], // NAT64 — maps onto IPv4, private ones included
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP literal lies outside the public internet. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const version = net.isIP(bare);
  if (version === 4) return BLOCKED.check(bare, "ipv4");
  if (version === 6) {
    // An IPv4-mapped address (::ffff:10.0.0.1) is the IPv4 address it names.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
    if (mapped) return BLOCKED.check(mapped[1], "ipv4");
    return BLOCKED.check(bare, "ipv6");
  }
  // Not an address at all: nothing to connect to, so nothing to allow.
  return true;
}

/**
 * Validate and canonicalise the share URL a user typed. Throws a
 * `WebdavSyncError` with the reason the UI words: `invalidUrl` for a typo,
 * `httpsRequired`, `blockedTarget` for a host this account may not reach.
 * A name is checked here only as far as it can be without resolving it; the
 * resolved address is checked at connection time (`guardedAgents`).
 */
export function normalizeWebdavUrl(raw: string, policy: TargetPolicy): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new WebdavSyncError("invalidUrl");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebdavSyncError("invalidUrl");
  }
  // The password belongs in its own encrypted field, never in a URL that is
  // stored and shown back in plain text.
  if (parsed.username || parsed.password) throw new WebdavSyncError("invalidUrl");
  if (parsed.search || parsed.hash) throw new WebdavSyncError("invalidUrl");

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = isLocalLlmHost(host);
  if (!policy.allowPrivate) {
    if (local || (net.isIP(host) !== 0 && isBlockedAddress(host))) {
      throw new WebdavSyncError("blockedTarget");
    }
    if (parsed.protocol !== "https:") throw new WebdavSyncError("httpsRequired");
  } else if (parsed.protocol !== "https:" && !local) {
    throw new WebdavSyncError("httpsRequired");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

/** `dns.lookup`, refusing every answer that is not a public address. */
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, []);
      return;
    }
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      callback(new WebdavSyncError("blockedTarget"), []);
      return;
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

type ConnectionOptions = http.ClientRequestArgs & { host?: string | null };

/** An IP literal never reaches `lookup` — Node connects to it directly. */
function assertLiteralAllowed(options: ConnectionOptions): void {
  const host = (options.host ?? options.hostname ?? "").replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new WebdavSyncError("blockedTarget");
  }
}

class GuardedHttpAgent extends http.Agent {
  createConnection(
    options: ConnectionOptions,
    callback?: (err: Error | null, stream: Duplex) => void
  ): Duplex {
    assertLiteralAllowed(options);
    return (
      http.Agent.prototype as unknown as {
        createConnection: (o: unknown, cb?: unknown) => Duplex;
      }
    ).createConnection.call(this, { ...options, lookup: guardedLookup }, callback);
  }
}

class GuardedHttpsAgent extends https.Agent {
  createConnection(
    options: ConnectionOptions,
    callback?: (err: Error | null, stream: Duplex) => void
  ): Duplex {
    assertLiteralAllowed(options);
    return (
      https.Agent.prototype as unknown as {
        createConnection: (o: unknown, cb?: unknown) => Duplex;
      }
    ).createConnection.call(this, { ...options, lookup: guardedLookup }, callback);
  }
}

/** Socket idle timeout: a share that stops answering mid-upload. */
const SOCKET_TIMEOUT_MS = 60_000;

/**
 * The agents a WebDAV client for this policy connects through. `undefined`
 * for an admin's policy: a LAN share is allowed, so there is nothing to check.
 */
export function guardedAgents(
  policy: TargetPolicy
): { httpAgent: http.Agent; httpsAgent: https.Agent } | undefined {
  if (policy.allowPrivate) return undefined;
  return {
    httpAgent: new GuardedHttpAgent({ timeout: SOCKET_TIMEOUT_MS }),
    httpsAgent: new GuardedHttpsAgent({ timeout: SOCKET_TIMEOUT_MS }),
  };
}
