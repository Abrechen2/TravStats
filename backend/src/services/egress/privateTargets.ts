/**
 * Where an account's OWN Immich or Dawarich connection may connect — the SSRF
 * boundary of both integrations (forgejo#411).
 *
 * The base URL of these connections used to be free: any http(s) host,
 * private ranges included, on the reasoning that the operator sets it and the
 * server is on the LAN by design. That holds for the admin-global and ENV
 * tiers, and for an admin's own connection. It does not hold for an ordinary
 * account on a multi-user instance: there the URL is chosen by someone who does
 * not control the instance, and the server's answer (the error kind, a proxied
 * body) makes the request a scanner of the instance's own network.
 *
 * So the rule follows the WebDAV target (`webdavSync/targetPolicy.ts`, whose
 * address list and DNS pinning this reuses):
 *
 *  - an admin account, the admin-global tier and ENV keep LAN access;
 *  - an ordinary account's own connection reaches PUBLIC addresses only. The
 *    URL is checked when saved and when tested, and every address a name
 *    resolves to is checked again when each socket opens, so a DNS answer that
 *    changes after the check (rebinding) gains nothing;
 *  - redirects are never followed, for anyone: a public server answering 302
 *    towards `169.254.169.254` would otherwise walk straight past both checks.
 *
 * Unlike WebDAV, plain http stays allowed: the request carries an API key, not
 * a whole file, and many self-hosted servers sit behind a plain-http proxy.
 */
import http from "http";
import https from "https";
import net from "net";
import type { Duplex } from "stream";
import { Agent as UndiciAgent, type Dispatcher } from "undici";

import { prisma } from "../../db";
import { isLocalLlmHost } from "../llm/llmEndpoint";
import { isBlockedAddress, makeGuardedLookup, type TargetPolicy } from "../webdavSync/targetPolicy";

export type { TargetPolicy };

/** The stable code a refusal carries beside the `invalidUrl` kind. */
export const PRIVATE_TARGET_CODE = "PRIVATE_TARGET" as const;
export type PrivateTargetCode = typeof PRIVATE_TARGET_CODE;

/** The target is not on the public internet and this caller may not reach it. */
export class PrivateTargetError extends Error {
  public readonly code: PrivateTargetCode = PRIVATE_TARGET_CODE;

  constructor() {
    super("Target is not on the public internet");
    this.name = "PrivateTargetError";
  }
}

/**
 * Whether anything in an error's cause chain is a `PrivateTargetError`. axios
 * and fetch wrap the lookup failure (`AxiosError.cause`, `TypeError.cause`),
 * so the refusal has to be dug out to keep its own kind instead of reading as
 * `unreachable`. fetch hands the cause back as a plain `Error` whose message
 * starts with the original's name (measured on Node 22 with undici 7), hence
 * the second test.
 */
export function isPrivateTargetRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof PrivateTargetError) return true;
    // Duck-typed: the wrapper may come from another realm (Node's own fetch).
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && message.startsWith("PrivateTargetError:")) return true;
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

/** A hostname that is not public, judged without resolving it. */
function isPrivateHostLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return isLocalLlmHost(host) || (net.isIP(host) !== 0 && isBlockedAddress(host));
}

/**
 * Refuse a URL whose host is visibly not public — an IP literal in a private,
 * loopback or link-local range, `localhost`, a `.local`/`.lan` name or a
 * single-label LAN name. A public-looking name is checked again at connection
 * time by the pinned lookup.
 */
export function assertTargetAllowed(url: string, policy: TargetPolicy): void {
  if (policy.allowPrivate) return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new PrivateTargetError();
  }
  if (isPrivateHostLiteral(host)) throw new PrivateTargetError();
}

/**
 * Whether this account may name a LAN server: admins only. Read on every
 * resolution, not only on save, so a demoted account loses its LAN target on
 * its next request.
 */
export async function accountMayReachPrivate(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin ?? false;
}

const pinnedLookup = makeGuardedLookup(() => new PrivateTargetError());

type ConnectionOptions = http.ClientRequestArgs & { host?: string | null };

function assertLiteralAllowed(options: ConnectionOptions): void {
  const host = (options.host ?? options.hostname ?? "").replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0 && isBlockedAddress(host)) throw new PrivateTargetError();
}

function connectWith(
  proto: http.Agent,
  self: http.Agent,
  options: ConnectionOptions,
  callback?: (err: Error | null, stream: Duplex) => void
): Duplex {
  assertLiteralAllowed(options);
  return (
    proto as unknown as { createConnection: (o: unknown, cb?: unknown) => Duplex }
  ).createConnection.call(self, { ...options, lookup: pinnedLookup }, callback);
}

class PublicOnlyHttpAgent extends http.Agent {
  createConnection(
    options: ConnectionOptions,
    callback?: (err: Error | null, stream: Duplex) => void
  ): Duplex {
    return connectWith(http.Agent.prototype, this, options, callback);
  }
}

class PublicOnlyHttpsAgent extends https.Agent {
  createConnection(
    options: ConnectionOptions,
    callback?: (err: Error | null, stream: Duplex) => void
  ): Duplex {
    return connectWith(https.Agent.prototype, this, options, callback);
  }
}

let publicAgents: { httpAgent: http.Agent; httpsAgent: https.Agent } | null = null;
let publicDispatcher: Dispatcher | null = null;

/**
 * The axios agents for this policy: none (the defaults) when LAN access is
 * allowed, otherwise agents whose every socket resolves through the pinned
 * lookup.
 */
export function axiosAgentsFor(policy: TargetPolicy): {
  httpAgent?: http.Agent;
  httpsAgent?: https.Agent;
} {
  if (policy.allowPrivate) return {};
  publicAgents ??= {
    httpAgent: new PublicOnlyHttpAgent({ keepAlive: true }),
    httpsAgent: new PublicOnlyHttpsAgent({ keepAlive: true }),
  };
  return publicAgents;
}

/** The fetch dispatcher for this policy — the same rule as `axiosAgentsFor`. */
export function fetchDispatcherFor(policy: TargetPolicy): Dispatcher | undefined {
  if (policy.allowPrivate) return undefined;
  publicDispatcher ??= new UndiciAgent({ connect: { lookup: pinnedLookup } });
  return publicDispatcher;
}
