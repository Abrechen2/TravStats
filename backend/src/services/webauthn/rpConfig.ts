import { prisma } from "../../db";

export interface RpConfig {
  /** The single RP ID every credential on this instance is minted under. */
  rpId: string;
  /** The origin registration ceremonies are expected to come from. */
  origin: string;
  /**
   * Every origin a ceremony may legitimately arrive from. `origin` is always
   * the first entry. @simplewebauthn verifies against the whole list, which is
   * what lets one rpId cover several subdomains.
   */
  origins: string[];
  rpName: string;
}

export type PasskeyUnavailableReason = "notConfigured" | "insecureOrigin";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Why passkeys cannot be offered for this origin, or null when they can.
 *
 * WebAuthn requires a secure context. Browsers make one exception —
 * localhost — so a developer can work over plain http. A LAN IP or a .local
 * name over http is NOT exempt: the browser rejects the ceremony outright, and
 * a button that always fails is worse than an honest explanation.
 */
export function passkeyUnavailableReason(url: string | null): PasskeyUnavailableReason | null {
  if (!url) return "notConfigured";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "notConfigured";
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname)) return null;
  return "insecureOrigin";
}

/**
 * An rpId must be a valid domain — never a bare IP address and never a URL.
 * Getting this wrong mints credentials the browser will refuse to use, so it is
 * rejected here rather than discovered at the authenticator.
 */
export function isValidRpId(rpId: string): boolean {
  if (rpId.length === 0 || rpId.includes("/") || rpId.includes(":")) return false;
  if (rpId === "localhost") return true;
  // A bare IPv4 address is not a registrable domain.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rpId)) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(rpId);
}

/**
 * The relying-party identity for this instance, or null when passkeys are not
 * possible here. Falls back to the configured public URL so an admin who never
 * opens the passkey settings still gets a sensible default.
 */
export async function resolveRpConfig(): Promise<RpConfig | null> {
  const row = await prisma.adminSettings.findFirst({
    select: {
      webauthnRpId: true,
      webauthnOrigins: true,
      publicUrl: true,
      instanceName: true,
    },
  });

  const configured = row?.webauthnOrigins ?? [];
  const primary = configured[0] ?? row?.publicUrl ?? null;
  if (passkeyUnavailableReason(primary) !== null) return null;

  const primaryUrl = new URL(primary!);
  // Only usable origins reach the verifier — a misconfigured http://LAN entry
  // in the list must not widen what we accept.
  const extra = configured
    .slice(1)
    .filter((o) => passkeyUnavailableReason(o) === null)
    .map((o) => new URL(o).origin);

  const rpId = row?.webauthnRpId ?? primaryUrl.hostname;
  if (!isValidRpId(rpId)) return null;

  return {
    rpId,
    origin: primaryUrl.origin,
    origins: [primaryUrl.origin, ...extra.filter((o) => o !== primaryUrl.origin)],
    rpName: row?.instanceName ?? "TravStats",
  };
}
