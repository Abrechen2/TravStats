/** Public identity only. Never put keys, invitations, sessions or recovery codes in this QR. */
const PREFIX = "travstats-e2e:v2:";
export function fingerprintCode(fingerprint: string): string {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw Error("E2E_FINGERPRINT");
  return PREFIX + fingerprint;
}
export function readFingerprintCode(value: string): string {
  if (!value.startsWith(PREFIX)) throw Error("E2E_FINGERPRINT");
  const fingerprint = value.slice(PREFIX.length);
  if (fingerprintCode(fingerprint) !== value) throw Error("E2E_FINGERPRINT");
  return fingerprint;
}
