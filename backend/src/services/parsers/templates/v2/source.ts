import logger from "../../../../utils/logger";

/**
 * Where templates come from: the raw-file root of a template repository.
 *
 * The v2 index lives at `<base>/index.json`, the legacy v1 airline index at
 * `<base>/templates/index.json`. Read from `TEMPLATE_REPO_BASE_URL`; the plan
 * makes this an admin setting later. Like the Immich URL there is no egress
 * allowlist — an admin may point at a private Git host on the LAN — but it
 * must be https, because the fetcher speaks nothing else.
 */
export const DEFAULT_TEMPLATE_REPO_BASE_URL =
  "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main";

export function resolveTemplateRepoBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_TEMPLATE_REPO_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("not https");
    return value.replace(/\/+$/, "");
  } catch {
    logger.warn(
      { value },
      "TEMPLATE_REPO_BASE_URL is not an https URL — using the official template repository"
    );
    return DEFAULT_TEMPLATE_REPO_BASE_URL;
  }
}
