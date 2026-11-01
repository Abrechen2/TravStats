/**
 * One field takes either an authenticator code or a backup code ("Code aus der
 * Authenticator-App oder ein Ersatzcode"); the server wants them apart. Six
 * digits (spaces allowed) are an authenticator code, anything else a backup code.
 */
export function secondFactorField(
  input: string
): { code: string } | { recoveryCode: string } | Record<string, never> {
  const value = input.trim();
  if (value === "") return {};
  return /^\d{6}$/.test(value.replace(/\s+/g, ""))
    ? { code: value.replace(/\s+/g, "") }
    : { recoveryCode: value };
}
