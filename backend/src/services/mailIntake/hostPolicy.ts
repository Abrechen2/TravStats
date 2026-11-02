/**
 * Where a PERSONAL mailbox may connect. The host is typed by an account on a
 * possibly multi-user instance, so — as for per-account WebDAV targets
 * (`webdavSync/targetPolicy.ts`, forgejo#321) — it must be a public address:
 * otherwise "test the connection" is a port scanner for the instance's own
 * network. The instance mailbox is the admin's and may sit on the LAN, as an
 * Immich does.
 *
 * Every address the name resolves to is checked, and the socket then goes to
 * the address that was checked rather than resolving again, so a DNS answer
 * that changes between check and connect (rebinding) gains nothing. The check
 * runs on save AND on every connect.
 */
import dns from "dns";

import { isBlockedAddress } from "../webdavSync/targetPolicy";
import { MailIntakeError } from "./errors";
import type { MailboxConnection } from "./mailFetcher";

export async function resolvePublicHost(host: string): Promise<string> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new MailIntakeError("host_not_found");
  }
  if (addresses.length === 0) throw new MailIntakeError("host_not_found");
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    throw new MailIntakeError("blocked_host");
  }
  return addresses[0].address;
}

/** The connection a personal source may use: checked and pinned to a public address. */
export async function pinPublic(connection: MailboxConnection): Promise<MailboxConnection> {
  return { ...connection, connectHost: await resolvePublicHost(connection.host) };
}
