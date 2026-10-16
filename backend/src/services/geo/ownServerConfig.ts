/** Operator-controlled, instance-wide opt-in. Never accept this URL from a request. */
export function parseOwnGeoUrl(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  try {
    const url = new URL(value);
    if (
      value !== value.trim() || url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/" || !url.hostname
    ) throw new Error();
    return url.origin;
  } catch {
    throw new Error("TRAVSTATS_GEO_URL must be an HTTPS origin without credentials, path, query or fragment");
  }
}

export function ownGeoUrl(): string | null {
  return parseOwnGeoUrl(process.env.TRAVSTATS_GEO_URL);
}
