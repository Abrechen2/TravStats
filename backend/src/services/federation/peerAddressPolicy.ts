/**
 * Which addresses a federation peer may live at: the one place that decides.
 *
 * Default (env `FEDERATION_PRIVATE_PEERS` unset): a peer is a public https origin without port,
 * reached only at public addresses. An operator whose servers share a LAN opts in with a
 * comma-separated CIDR list (`192.168.178.0/24,fd00::/8`). Then a peer origin may be http and
 * carry a port, and a host may resolve into a listed range. Loopback, link-local (cloud metadata
 * at 169.254.169.254 included), unspecified and multicast stay refused even if a CIDR covers them.
 */
import { BlockList, isIP } from "net";
import logger from "../../utils/logger";

const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(ip, bits, "ipv6");

/** A globally routable unicast address. */
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 && global6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** Never a federation peer, whatever the operator lists. */
const never = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
] as const)
  never.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  never.addSubnet(ip, bits, "ipv6");

export const PRIVATE_PEERS_ENV = "FEDERATION_PRIVATE_PEERS";

let parsedFor: string | undefined;
let parsedList: BlockList | null = null;

function parseList(raw: string): BlockList | null {
  const list = new BlockList();
  const kept: string[] = [];
  for (const entry of raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const [net, bitsText, extra] = entry.split("/");
    const family = isIP(net ?? "");
    const bits = Number(bitsText);
    const max = family === 4 ? 32 : 128;
    if (
      !family ||
      extra !== undefined ||
      !/^\d{1,3}$/.test(bitsText ?? "") ||
      !(bits >= 0 && bits <= max)
    ) {
      logger.warn({ entry }, `${PRIVATE_PEERS_ENV}: invalid CIDR ignored`);
      continue;
    }
    list.addSubnet(net as string, bits, family === 4 ? "ipv4" : "ipv6");
    kept.push(entry);
  }
  if (!kept.length) return null;
  logger.warn(
    { cidrs: kept },
    `${PRIVATE_PEERS_ENV} is set: federation may reach http peers and ports inside these ranges`
  );
  return list;
}

/** The operator's list, parsed once per distinct value of the variable (tests change it). */
function privateList(): BlockList | null {
  const raw = process.env[PRIVATE_PEERS_ENV] ?? "";
  if (raw !== parsedFor) {
    parsedFor = raw;
    parsedList = raw.trim() ? parseList(raw) : null;
  }
  return parsedList;
}

export const lanPeersEnabled = (): boolean => privateList() !== null;

/** `[::1]` → `::1`; IPv4-mapped IPv6 → the IPv4 address it stands for. */
export function bareHost(host: string): string {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  return mapped ? (mapped[1] as string) : bare;
}

function check(list: BlockList, address: string): boolean {
  const family = isIP(address);
  return family !== 0 && list.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Inside a range the operator listed, and not one that is never allowed. */
export function listedPrivateAddress(address: string): boolean {
  const list = privateList();
  const a = bareHost(address);
  return list !== null && !check(never, a) && check(list, a);
}

/** An address a peer may be reached at: public, or (opt-in) inside a listed range. */
export function peerAddressAllowed(address: string): boolean {
  const a = bareHost(address);
  return publicAddress(a) || listedPrivateAddress(a);
}

/**
 * Syntactic check of a peer origin (no DNS). Canonical form only: `new URL(v).origin === v`, no
 * credentials, path, query or fragment. https without a port always; with the opt-in also http,
 * an explicit port, and IP literals only inside a listed range.
 */
export function peerOriginAcceptable(v: string): boolean {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.origin !== v || u.username || u.password) return false;
  if (!lanPeersEnabled()) return u.protocol === "https:" && !u.port;
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = bareHost(u.hostname);
  return isIP(host) === 0 || peerAddressAllowed(host);
}

export function peerOriginRule(): string {
  return lanPeersEnabled()
    ? "An http(s) origin of a public server or one inside FEDERATION_PRIVATE_PEERS, without path or credentials"
    : `An https origin without port, path or credentials (LAN peers: set ${PRIVATE_PEERS_ENV})`;
}
